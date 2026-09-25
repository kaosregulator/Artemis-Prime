/**
 * Truth or Dare — game logic, persistence, rewards.
 * Rewards use existing clanPoints (no separate UnbelievaBoat economy).
 */
import {
  db,
  todPlayersTable,
  todChallengesTable,
  todAnonymousTable,
  todCustomContentTable,
  type Clan,
  type TodChallenge,
  type TodPlayer,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { awardClanPoints } from "./player";
import { type MemberIdentity } from "./config";
import { activityDate } from "./time";
import {
  BUILTIN_TOD_CONTENT,
  DIFFICULTY_EMOJI,
  pickContent,
  rewardFor,
  spinWheel,
  STREAK_MILESTONES,
  TOD_TITLES,
  type TodContentItem,
  type TodContentType,
  type TodDifficulty,
  type SpinKey,
} from "./tod/content";
import { logger } from "../../lib/logger";

export interface TodSettings {
  enabled: boolean;
  economyRewards: boolean;
  highStakes: boolean;
  irlMode: boolean;
  anonymous: boolean;
  cooldownSeconds: number;
  challengeTimeoutMinutes: number;
  proofTimeoutMinutes: number;
  highStakesPassPenalty: number;
}

export const DEFAULT_TOD_SETTINGS: TodSettings = {
  enabled: true,
  economyRewards: true,
  highStakes: false,
  irlMode: true,
  anonymous: true,
  cooldownSeconds: 45,
  challengeTimeoutMinutes: 15,
  proofTimeoutMinutes: 10,
  highStakesPassPenalty: 500,
};

export function getTodSettings(clan: Clan): TodSettings {
  const base = { ...DEFAULT_TOD_SETTINGS, enabled: clan.todEnabled !== false };
  if (!clan.todSettingsJson?.trim()) return base;
  try {
    const parsed = JSON.parse(clan.todSettingsJson) as Partial<TodSettings>;
    return { ...base, ...parsed, enabled: clan.todEnabled !== false && parsed.enabled !== false };
  } catch {
    return base;
  }
}

const cooldowns = new Map<string, number>();

export function checkTodCooldown(
  guildId: string,
  userId: string,
  seconds: number
): { ok: true } | { ok: false; retryIn: number } {
  const key = `${guildId}:${userId}`;
  const until = cooldowns.get(key) ?? 0;
  const now = Date.now();
  if (now < until) return { ok: false, retryIn: Math.ceil((until - now) / 1000) };
  cooldowns.set(key, now + seconds * 1000);
  return { ok: true };
}

export async function ensureTodPlayer(opts: {
  guildId: string;
  userId: string;
  username: string;
  displayName: string;
}): Promise<TodPlayer> {
  const [existing] = await db
    .select()
    .from(todPlayersTable)
    .where(
      and(eq(todPlayersTable.guildId, opts.guildId), eq(todPlayersTable.userId, opts.userId))
    )
    .limit(1);
  if (existing) {
    if (
      existing.username !== opts.username ||
      existing.displayName !== opts.displayName
    ) {
      const [updated] = await db
        .update(todPlayersTable)
        .set({ username: opts.username, displayName: opts.displayName })
        .where(eq(todPlayersTable.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }
  const [created] = await db
    .insert(todPlayersTable)
    .values({
      guildId: opts.guildId,
      userId: opts.userId,
      username: opts.username,
      displayName: opts.displayName,
    })
    .returning();
  return created!;
}

async function guildContentPool(guildId: string): Promise<TodContentItem[]> {
  const custom = await db
    .select()
    .from(todCustomContentTable)
    .where(
      and(
        eq(todCustomContentTable.guildId, guildId),
        eq(todCustomContentTable.enabled, true)
      )
    );
  const mapped: TodContentItem[] = custom.map((c) => ({
    id: c.contentKey,
    type: c.type as TodContentType,
    category: c.category,
    difficulty: c.difficulty as TodDifficulty,
    text: c.text,
    requiresProof: c.requiresProof,
    enabled: true,
  }));
  return [...BUILTIN_TOD_CONTENT, ...mapped];
}

export async function selectPrompt(opts: {
  guildId: string;
  type?: TodContentType;
  category?: string;
  difficulty?: TodDifficulty;
  allowIrl?: boolean;
}): Promise<TodContentItem | null> {
  let pool = await guildContentPool(opts.guildId);
  if (!opts.allowIrl) pool = pool.filter((c) => c.category !== "irl");
  return pickContent({
    type: opts.type,
    category: opts.category,
    difficulty: opts.difficulty,
    pool,
  });
}

export async function createChallenge(opts: {
  clan: Clan;
  channelId: string;
  kind: string;
  targetId: string;
  targetUsername: string;
  challengerId?: string | null;
  content: TodContentItem;
  highStakes?: boolean;
}): Promise<TodChallenge> {
  const settings = getTodSettings(opts.clan);
  let reward = rewardFor(opts.content);
  if (opts.highStakes) reward = Math.round(reward * 2);
  const passPenalty =
    opts.highStakes && settings.highStakes ? settings.highStakesPassPenalty : 0;
  const timeoutMin = opts.content.requiresProof
    ? settings.proofTimeoutMinutes
    : settings.challengeTimeoutMinutes;
  const expiresAt = new Date(Date.now() + timeoutMin * 60_000);

  const [row] = await db
    .insert(todChallengesTable)
    .values({
      guildId: opts.clan.guildId,
      channelId: opts.channelId,
      kind: opts.kind,
      status: "active",
      challengerId: opts.challengerId ?? null,
      targetId: opts.targetId,
      targetUsername: opts.targetUsername,
      contentId: opts.content.id,
      contentType: opts.content.type,
      category: opts.content.category,
      difficulty: opts.content.difficulty,
      promptText: opts.content.text,
      requiresProof: !!opts.content.requiresProof,
      highStakes: !!opts.highStakes,
      rewardPoints: reward,
      passPenalty,
      expiresAt,
    })
    .returning();
  return row!;
}

export async function getActiveChallenge(
  guildId: string,
  challengeId: number
): Promise<TodChallenge | null> {
  const [row] = await db
    .select()
    .from(todChallengesTable)
    .where(
      and(eq(todChallengesTable.id, challengeId), eq(todChallengesTable.guildId, guildId))
    )
    .limit(1);
  return row ?? null;
}

export async function bindChallengeMessage(
  challengeId: number,
  messageId: string
): Promise<void> {
  await db
    .update(todChallengesTable)
    .set({ messageId })
    .where(eq(todChallengesTable.id, challengeId));
}

function titleForPlayer(p: TodPlayer): string | null {
  const total = p.truthsCompleted + p.daresCompleted;
  let best: string | null = null;
  let bestMin = -1;
  for (const [key, meta] of Object.entries(TOD_TITLES)) {
    if (total >= meta.minCompleted && meta.minCompleted > bestMin) {
      best = key;
      bestMin = meta.minCompleted;
    }
  }
  // Prefer truth/dare master when skewed
  if (p.truthsCompleted >= 25 && p.truthsCompleted >= p.daresCompleted) {
    best = "truth_master";
  } else if (p.daresCompleted >= 25 && p.daresCompleted > p.truthsCompleted) {
    best = "dare_master";
  }
  return best;
}

export async function completeChallenge(opts: {
  clan: Clan;
  challenge: TodChallenge;
  actorId: string;
}): Promise<{ player: TodPlayer; milestone: number | null; awarded: number }> {
  const settings = getTodSettings(opts.clan);
  const day = activityDate(opts.clan);

  await db
    .update(todChallengesTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(todChallengesTable.id, opts.challenge.id));

  const player = await ensureTodPlayer({
    guildId: opts.clan.guildId,
    userId: opts.challenge.targetId,
    username: opts.challenge.targetUsername,
    displayName: opts.challenge.targetUsername,
  });

  let dailyStreak = player.dailyStreak;
  if (player.lastCompletedDate === day) {
    // same day — keep
  } else {
    const prev = player.lastCompletedDate;
    // naive consecutive day check via string compare of YYYY-MM-DD after parsing
    dailyStreak = prev ? dailyStreak + 1 : 1;
  }

  const currentStreak = player.currentStreak + 1;
  const bestStreak = Math.max(player.bestStreak, currentStreak);
  const awarded = settings.economyRewards ? opts.challenge.rewardPoints : 0;

  const isTruth = opts.challenge.contentType === "truth";
  const [updated] = await db
    .update(todPlayersTable)
    .set({
      truthsCompleted: sql`${todPlayersTable.truthsCompleted} + ${isTruth ? 1 : 0}`,
      daresCompleted: sql`${todPlayersTable.daresCompleted} + ${isTruth ? 0 : 1}`,
      challengesCompleted: sql`${todPlayersTable.challengesCompleted} + 1`,
      currentStreak,
      bestStreak,
      dailyStreak,
      lastCompletedDate: day,
      todPoints: sql`${todPlayersTable.todPoints} + ${awarded}`,
      wins:
        opts.challenge.challengerId && opts.challenge.challengerId !== opts.challenge.targetId
          ? sql`${todPlayersTable.wins} + 1`
          : player.wins,
    })
    .where(eq(todPlayersTable.id, player.id))
    .returning();

  const fresh = updated ?? player;
  const titleKey = titleForPlayer(fresh);
  if (titleKey && titleKey !== fresh.titleKey) {
    await db
      .update(todPlayersTable)
      .set({ titleKey })
      .where(eq(todPlayersTable.id, fresh.id));
    fresh.titleKey = titleKey;
  }

  if (awarded > 0) {
    try {
      const identity: MemberIdentity = {
        userId: opts.challenge.targetId,
        username: opts.challenge.targetUsername,
        displayName: opts.challenge.targetUsername,
        avatarUrl: null,
      };
      await awardClanPoints(opts.clan, identity, awarded);
    } catch (err) {
      logger.warn({ err }, "TOD clanPoints award failed");
    }
  }

  const milestone =
    STREAK_MILESTONES.find((m) => currentStreak === m) ?? null;

  return { player: fresh, milestone, awarded };
}

export async function passChallenge(opts: {
  clan: Clan;
  challenge: TodChallenge;
}): Promise<TodPlayer> {
  const settings = getTodSettings(opts.clan);
  await db
    .update(todChallengesTable)
    .set({ status: "passed", completedAt: new Date() })
    .where(eq(todChallengesTable.id, opts.challenge.id));

  const player = await ensureTodPlayer({
    guildId: opts.clan.guildId,
    userId: opts.challenge.targetId,
    username: opts.challenge.targetUsername,
    displayName: opts.challenge.targetUsername,
  });

  let penalty = 0;
  if (opts.challenge.highStakes && settings.highStakes) {
    penalty = Math.min(player.todPoints, opts.challenge.passPenalty);
  }

  const [updated] = await db
    .update(todPlayersTable)
    .set({
      challengesPassed: sql`${todPlayersTable.challengesPassed} + 1`,
      currentStreak: 0,
      todPoints: sql`greatest(0, ${todPlayersTable.todPoints} - ${penalty})`,
      losses:
        opts.challenge.challengerId && opts.challenge.challengerId !== opts.challenge.targetId
          ? sql`${todPlayersTable.losses} + 1`
          : player.losses,
    })
    .where(eq(todPlayersTable.id, player.id))
    .returning();

  return updated ?? player;
}

export async function listTodLeaderboard(
  guildId: string,
  sort: "completed" | "dares" | "truths" | "streak" | "points" | "wins" = "completed",
  limit = 10
): Promise<TodPlayer[]> {
  const order =
    sort === "dares"
      ? desc(todPlayersTable.daresCompleted)
      : sort === "truths"
        ? desc(todPlayersTable.truthsCompleted)
        : sort === "streak"
          ? desc(todPlayersTable.bestStreak)
          : sort === "points"
            ? desc(todPlayersTable.todPoints)
            : sort === "wins"
              ? desc(todPlayersTable.wins)
              : desc(todPlayersTable.challengesCompleted);
  return db
    .select()
    .from(todPlayersTable)
    .where(eq(todPlayersTable.guildId, guildId))
    .orderBy(order)
    .limit(limit);
}

export async function submitAnonymous(opts: {
  guildId: string;
  authorId: string;
  body: string;
  channelId?: string | null;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(todAnonymousTable)
    .values({
      guildId: opts.guildId,
      authorId: opts.authorId,
      body: opts.body.slice(0, 500),
      channelId: opts.channelId ?? null,
    })
    .returning();
  return { id: row!.id };
}

export async function guessAnonymous(opts: {
  guildId: string;
  anonymousId: number;
  guessUserId: string;
}): Promise<{ correct: boolean } | { error: string }> {
  const [row] = await db
    .select()
    .from(todAnonymousTable)
    .where(
      and(
        eq(todAnonymousTable.id, opts.anonymousId),
        eq(todAnonymousTable.guildId, opts.guildId)
      )
    )
    .limit(1);
  if (!row) return { error: "Anonymous truth not found." };
  if (row.guessUserId) return { error: "Already guessed." };
  const correct = row.authorId === opts.guessUserId;
  await db
    .update(todAnonymousTable)
    .set({ guessUserId: opts.guessUserId, guessCorrect: correct })
    .where(eq(todAnonymousTable.id, row.id));
  return { correct };
}

export async function expireStaleChallenges(): Promise<number> {
  const result = await db
    .update(todChallengesTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(todChallengesTable.status, "active"),
        sql`${todChallengesTable.expiresAt} IS NOT NULL AND ${todChallengesTable.expiresAt} < now()`
      )
    )
    .returning({ id: todChallengesTable.id });
  return result.length;
}

export function formatChallengeEmbedFields(content: TodContentItem, reward: number) {
  return {
    difficultyLine: `${DIFFICULTY_EMOJI[content.difficulty]} ${content.difficulty}`,
    categoryLine: content.category,
    rewardLine: `💰 +${reward.toLocaleString("en-US")} clan points`,
  };
}

export { spinWheel, rewardFor, DIFFICULTY_EMOJI, TOD_TITLES };
export type { SpinKey, TodContentItem };
