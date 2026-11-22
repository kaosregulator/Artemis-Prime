/**
 * Roll call: staff pick everyone they noticed, the bot suggests a reminder or
 * a warning for each person, staff adjust, and one grouped message posts.
 *
 * The suggestion follows ORDER, not a time window: a reminder comes before a
 * warning. If someone's latest reminder (in this activity) hasn't been
 * followed by a warning yet, the next step is a warning; otherwise it's a
 * reminder. Staff always see when the last reminder was, and can flip anyone.
 *
 * The one time-based check is a duplicate guard: someone handled in the last
 * few hours (e.g. two officers running roll call back to back) is suggested
 * as "skip" so they don't jump straight to a warning by accident.
 */
import type { Clan, ClanMember } from "@workspace/db";
import { db, remindersTable, warningsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import type { Guild } from "discord.js";
import { shouldHoldWarningRole } from "./warningRole";
import { countActive, isImmuneFromEnforcement } from "./warnings";
import { getMember } from "./config";

export type RollAction = "reminder" | "warning" | "skip";

/** Someone handled within this long is suggested as "skip" (duplicate guard). */
export const RECENTLY_HANDLED_MS = 6 * 3600_000;
export const ROLL_CALL_MAX = 25;

export interface RollFacts {
  userId: string;
  name: string;
  isBot: boolean;
  /** "on leave", "exempt role", … — null when the member can be reminded/warned. */
  immuneReason: string | null;
  lastReminderAt: Date | null;
  lastReminderBy: string | null;
  lastWarningAt: Date | null;
  lastWarningBy: string | null;
  activeCount: number;
}

export interface RollEntry extends RollFacts {
  action: RollAction;
  /** What the bot suggested before any staff change. */
  suggested: RollAction;
  /** Short staff-facing explanation, e.g. "reminded <t:…:R>, no warning since". */
  why: string;
  /** This warning would turn the XP warning role on. */
  getsRole: boolean;
}

const ts = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;
const by = (name: string | null) => (name ? ` by ${name}` : "");

/** Pure: the bot's suggestion for one person. */
export function suggestAction(f: RollFacts, now = new Date()): { action: RollAction; why: string } {
  if (f.isBot) return { action: "skip", why: "bot account" };
  if (f.immuneReason) return { action: "skip", why: f.immuneReason };

  const latest = [f.lastReminderAt, f.lastWarningAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (latest && now.getTime() - latest.getTime() < RECENTLY_HANDLED_MS) {
    const wasWarning = !!f.lastWarningAt && latest.getTime() === f.lastWarningAt.getTime();
    return {
      action: "skip",
      why: `${wasWarning ? "warned" : "reminded"} ${ts(latest)}${by(wasWarning ? f.lastWarningBy : f.lastReminderBy)}`,
    };
  }

  const openReminder =
    !!f.lastReminderAt && (!f.lastWarningAt || f.lastReminderAt.getTime() > f.lastWarningAt.getTime());
  if (openReminder) {
    return { action: "warning", why: `reminded ${ts(f.lastReminderAt!)}, no warning since` };
  }
  if (f.lastWarningAt) return { action: "reminder", why: `last warned ${ts(f.lastWarningAt)}` };
  return { action: "reminder", why: "first reminder" };
}

/** Would a new warning switch the XP warning role on for this person? */
export function warningAddsRole(clan: Pick<Clan, "warningRoleIds">, activeCount: number): boolean {
  return (
    clan.warningRoleIds.length > 0 &&
    !shouldHoldWarningRole(activeCount) &&
    shouldHoldWarningRole(activeCount + 1)
  );
}

/** Pure: apply staff overrides on top of the suggestions. */
export function buildPlan(
  clan: Pick<Clan, "warningRoleIds">,
  facts: RollFacts[],
  overrides: ReadonlyMap<string, RollAction> = new Map(),
  now = new Date()
): RollEntry[] {
  return facts.map((f) => {
    const s = suggestAction(f, now);
    // Bots can never be reminded/warned, whatever was selected.
    const action = f.isBot ? "skip" : (overrides.get(f.userId) ?? s.action);
    return {
      ...f,
      suggested: s.action,
      action,
      why: action === s.action ? s.why : `${s.why} · changed by staff`,
      getsRole: action === "warning" && warningAddsRole(clan, f.activeCount),
    };
  });
}

/** Load the facts the plan needs (≤ 25 people, a few small queries each). */
export async function loadRollFacts(
  clan: Clan,
  guild: Guild,
  people: Array<{ id: string; name: string; bot: boolean }>,
  categoryKey: string
): Promise<RollFacts[]> {
  return Promise.all(
    people.map(async (p): Promise<RollFacts> => {
      const member: ClanMember | null = await getMember(clan.guildId, p.id);
      const immune = p.bot ? { immune: false, reason: "" } : await isImmuneFromEnforcement(guild, clan, p.id, member);
      const [rem] = await db
        .select({ at: remindersTable.createdAt, by: remindersTable.sentByUsername })
        .from(remindersTable)
        .where(
          and(
            eq(remindersTable.guildId, clan.guildId),
            eq(remindersTable.userId, p.id),
            eq(remindersTable.categoryKey, categoryKey)
          )
        )
        .orderBy(desc(remindersTable.createdAt))
        .limit(1);
      // Any warning in this activity — a cleared one still "followed" the reminder.
      const [warn] = await db
        .select({ at: warningsTable.issuedAt, by: warningsTable.issuedByUsername })
        .from(warningsTable)
        .where(
          and(
            eq(warningsTable.guildId, clan.guildId),
            eq(warningsTable.userId, p.id),
            eq(warningsTable.categoryKey, categoryKey)
          )
        )
        .orderBy(desc(warningsTable.issuedAt))
        .limit(1);
      return {
        userId: p.id,
        name: p.name,
        isBot: p.bot,
        immuneReason: immune.immune ? immune.reason : null,
        lastReminderAt: rem?.at ?? null,
        lastReminderBy: rem?.by ?? null,
        lastWarningAt: warn?.at ?? null,
        lastWarningBy: warn?.by ?? null,
        activeCount: p.bot ? 0 : await countActive(clan.guildId, p.id),
      };
    })
  );
}

/* ------------------------------------------------------------ member copy */

/**
 * Lines for the one grouped channel message. Plain and short: what happened
 * and what to do. No thresholds, counts or quota language.
 */
export function rollCallCopy(activity: string) {
  const a = activity.trim() || "activity";
  return {
    title: `${a} check`,
    reminder: `We haven't seen you on ${a} lately. Hop in when you can.`,
    warning: `This is a warning for missing ${a}. If that's not right, open a ticket with \`/dispute\`.`,
    role: "now has the XP warning role.",
    memberWarningReason: `Missed ${a}.`,
  };
}
