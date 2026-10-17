import type { Client } from "discord.js";
import type { Clan } from "@workspace/db";
import dayjs from "dayjs";
import { logger } from "../lib/logger";
import { recordSchedulerTick } from "../lib/diagnostics";
import { activeClans } from "./services/config";
import { localHm, weekKey } from "./services/time";
import {
  listTracked,
  reminderTargets,
  rollWeek,
  getTrackingPeriod,
  periodKey,
} from "./services/progress";
import { periodAdjective } from "./services/tracking";
import { sendBulkReminders } from "./services/reminders";
import { refreshDashboardNow } from "./services/commandCenter";
import { expireStaleChallenges } from "./services/todGame";

const TICK_MS = 60_000;

// In-memory de-dupe of fired windows. The scheduler is single-process; on
// restart a window may re-fire at most once, which the per-member 20-hour
// reminder guard absorbs.
const firedWindows = new Set<string>();

let tickRunning = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let bootHandle: ReturnType<typeof setTimeout> | null = null;
let started = false;

function fireOnce(key: string): boolean {
  if (firedWindows.has(key)) return false;
  firedWindows.add(key);
  if (firedWindows.size > 5000) firedWindows.clear();
  return true;
}

/** Scheduled reminders for members who still owe the current activity period. */
async function runReminderWindow(client: Client, clan: Clan) {
  const guild = await client.guilds.fetch(clan.guildId).catch(() => null);
  const members = await listTracked(clan, guild);
  const targets = reminderTargets(clan, members);
  if (!targets.length) return;

  const res = await sendBulkReminders({
    client,
    clan,
    targets,
    auto: true,
    skipIfRemindedToday: true,
  });
  if (res.sent > 0) {
    logger.info(
      { guild: clan.guildId, sent: res.sent, period: periodAdjective(clan) },
      `Auto ${periodAdjective(clan)} reminders sent`
    );
  }
}

/**
 * Archive the activity period quietly. No staff close-out ping — warnings are
 * not tied to a period ending, and officers are not told who "missed" a quota.
 */
async function runPeriodReset(_client: Client, clan: Clan) {
  const res = await rollWeek(clan);
  logger.info(
    { guild: clan.guildId, archived: res.archived, period: periodAdjective(clan) },
    "Activity period archived"
  );
}

/** Back-compat alias used by tests / manual triggers. */
const runWeeklyReset = runPeriodReset;

async function tick(client: Client) {
  if (tickRunning) {
    recordSchedulerTick({ durationMs: 0, skippedOverlap: true });
    logger.warn("Scheduler tick skipped — previous tick still running");
    return;
  }
  tickRunning = true;
  const startedAt = Date.now();
  let failed = false;
  try {
    try {
      const n = await expireStaleChallenges();
      if (n > 0) logger.info({ expired: n }, "Expired stale ToD challenges");
    } catch (err) {
      logger.warn({ err }, "ToD expire tick failed");
    }

    let clans: Clan[] = [];
    try {
      clans = await activeClans();
    } catch (err) {
      logger.error({ err }, "Scheduler failed to load clans");
      failed = true;
      return;
    }

    for (const clan of clans) {
      try {
        const hhmm = localHm(clan);
        const dateKey = new Date().toISOString().slice(0, 10);
        const nowDay = dayjs().tz(clan.timezone || "UTC").day();
        const period = getTrackingPeriod(clan);

        const resetDue =
          clan.autoWeeklyReset &&
          hhmm === clan.resetTime &&
          (period === "daily" || nowDay === clan.weekStartDay) &&
          fireOnce(`${clan.guildId}:${dateKey}:reset:${periodKey(clan)}`);

        if (resetDue) {
          await runPeriodReset(client, clan);
          continue;
        }

        const reminderTime = clan.reminderTimes[0];
        if (
          clan.remindersEnabled &&
          reminderTime === hhmm &&
          clan.reminderDays.includes(nowDay) &&
          fireOnce(`${clan.guildId}:${dateKey}:${hhmm}:remind`)
        ) {
          await runReminderWindow(client, clan);
        }

        if (new Date().getMinutes() % 10 === 0) {
          await refreshDashboardNow(clan.guildId).catch(() => {});
        }
      } catch (err) {
        failed = true;
        logger.error({ err, guild: clan.guildId }, "Scheduler tick failed for clan");
      }
    }
  } finally {
    tickRunning = false;
    recordSchedulerTick({ durationMs: Date.now() - startedAt, failed });
  }
}

/** Start the periodic scheduler (idempotent per process). */
export function startScheduler(client: Client) {
  if (started) {
    logger.warn("Clan scheduler already started — skipping duplicate registration");
    return;
  }
  started = true;
  logger.info("Clan scheduler started");
  bootHandle = setTimeout(() => void tick(client), 10_000);
  intervalHandle = setInterval(() => void tick(client), TICK_MS);
}

/** Stop future ticks (active tick may finish). */
export function stopScheduler(): void {
  if (bootHandle) {
    clearTimeout(bootHandle);
    bootHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
  logger.info("Clan scheduler stopped");
}

/** Exposed for tests / manual triggers. */
export { runWeeklyReset, runPeriodReset, runReminderWindow, tick };

// weekKey is re-exported so callers logging scheduler state share one source.
export { weekKey };
