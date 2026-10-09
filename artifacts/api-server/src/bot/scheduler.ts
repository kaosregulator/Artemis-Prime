import type { Client, TextBasedChannel } from "discord.js";
import type { Clan } from "@workspace/db";
import dayjs from "dayjs";
import { logger } from "../lib/logger";
import { recordSchedulerTick } from "../lib/diagnostics";
import { activeClans } from "./services/config";
import { localHm, weekKey } from "./services/time";
import {
  listTracked,
  snapshotFrom,
  reminderTargets,
  warningTargets,
  rollWeek,
  getTrackingPeriod,
  periodKey,
} from "./services/progress";
import { periodAdjective, periodLabel } from "./services/tracking";
import { sendBulkReminders } from "./services/reminders";
import {
  autoExpireWarnings,
  clearWarningRolesForSatisfiedMembers,
} from "./services/warnings";
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

async function sendToChannel(client: Client, channelId: string | null, content: string) {
  if (!channelId) return;
  try {
    const channel = (await client.channels.fetch(channelId)) as TextBasedChannel | null;
    if (channel && "send" in channel) {
      await channel.send({ content, allowedMentions: { parse: ["roles"] } });
    }
  } catch (err) {
    logger.warn({ err, channelId }, "Scheduler failed to send channel message");
  }
}

function officerMention(clan: Clan): string {
  return [...clan.staffRoleIds, ...clan.adminRoleIds].map((r) => `<@&${r}>`).join(" ");
}

/** Scheduled reminders to everyone still short of the configured requirement. */
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
 * Close the tracking period: post the final summary to the officers, then
 * archive and reset. Runs at the period boundary when autoWeeklyReset is on
 * (daily → every day at resetTime; weekly → week-start day at resetTime).
 */
async function runPeriodReset(client: Client, clan: Clan) {
  const guild = await client.guilds.fetch(clan.guildId).catch(() => null);
  const members = await listTracked(clan, guild);
  const snap = snapshotFrom(clan, members);
  const channel = clan.warningChannelId ?? clan.logChannelId ?? clan.reminderChannelId;
  const label = periodLabel(clan);

  if (channel) {
    const pct = Math.round(snap.completionRate * 100);
    await sendToChannel(
      client,
      channel,
      `${officerMention(clan)} 📅 **${label} period closed** — ${snap.completed}/${snap.active} members hit the ${clan.activityName} goal (**${pct}%**). ` +
        `${snap.notStarted} never started · ${snap.warningsThisWeek} warning(s) issued this ${periodAdjective(clan)}.\n` +
        `Run \`/xp review\` for the full breakdown — progress has been archived and reset.`
    );
  }

  const res = await rollWeek(clan);
  logger.info(
    { guild: clan.guildId, archived: res.archived, period: periodAdjective(clan) },
    `${label} reset completed`
  );
}

/** Back-compat alias used by tests / manual triggers. */
const runWeeklyReset = runPeriodReset;

/** Nudge officers when many members are behind (staff-only channel). */
async function runOfficerMonitoring(client: Client, clan: Clan, dateKey: string) {
  const channel = clan.warningChannelId ?? clan.logChannelId;
  if (!channel) return;

  const guild = await client.guilds.fetch(clan.guildId).catch(() => null);
  const members = await listTracked(clan, guild);
  const snap = snapshotFrom(clan, members);
  const warnable = warningTargets(clan, members).length;
  if (!warnable) return;

  if (!fireOnce(`${clan.guildId}:${dateKey}:escalation`)) return;
  await sendToChannel(
    client,
    channel,
    `${officerMention(clan)} ⚠️ **${warnable}** member(s) are warning-eligible ` +
      `(${clan.warningThreshold}+ reminders, still short of the ${clan.activityName} ${periodAdjective(clan)} goal). ` +
      `${snap.completed}/${snap.active} complete. Run \`/xp review\` to issue warnings in bulk.`
  );
}

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

        if (reminderTime && hhmm === bumpHour(reminderTime)) {
          await runOfficerMonitoring(client, clan, dateKey);
        }

        if (clan.warningRemovalHours > 0 && new Date().getMinutes() % 10 === 0) {
          await autoExpireWarnings(client, clan).catch(() => {});
        }

        if (new Date().getMinutes() % 10 === 0) {
          await clearWarningRolesForSatisfiedMembers(client, clan).catch(() => {});
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

/** "18:00" -> "19:00" (wraps at midnight). */
function bumpHour(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = (parseInt(h, 10) + 1) % 24;
  return `${String(hour).padStart(2, "0")}:${m}`;
}

/** Start the periodic scheduler (idempotent per process). */
export function startScheduler(client: Client) {
  if (started) {
    logger.warn("XP tracking scheduler already started — skipping duplicate registration");
    return;
  }
  started = true;
  logger.info("XP tracking scheduler started");
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
  logger.info("XP tracking scheduler stopped");
}

/** Exposed for tests / manual triggers. */
export { runWeeklyReset, runPeriodReset, runReminderWindow, tick };

// weekKey is re-exported so callers logging scheduler state share one source.
export { weekKey };
