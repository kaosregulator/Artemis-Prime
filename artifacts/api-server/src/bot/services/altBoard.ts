/**
 * Patriots / Guardians alt-account daily board.
 * Completely separate from warnings / clean standing.
 */
import {
  db,
  altDailyLogsTable,
  dashboardsTable,
  type Clan,
  type AltDailyLog,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import { getMember } from "./config";
import { activityDate } from "./time";
import { renderOffThread } from "../canvas/render-pool";
import { ALT_SUBMIT, ALT_LEADERBOARD_REFRESH } from "../ui/ids";
import { logger } from "../../lib/logger";

const DASH_TYPE = "patriot";
const MIN_ALTS = 1;
const MAX_ALTS = 100;

let altClient: Client | null = null;

export function setAltBoardClient(client: Client): void {
  altClient = client;
}

export function clampAltCount(n: number): number | null {
  if (!Number.isInteger(n) || n < MIN_ALTS || n > MAX_ALTS) return null;
  return n;
}

export async function upsertAltDaily(opts: {
  clan: Clan;
  userId: string;
  username: string;
  displayName: string;
  altCount: number;
  activityDate?: string;
  recordedBy: string;
  recordedByUsername: string;
  note?: string | null;
}): Promise<{ ok: true; row: AltDailyLog; date: string } | { ok: false; error: string }> {
  const count = clampAltCount(opts.altCount);
  if (count == null) {
    return { ok: false, error: `Enter a whole number from **${MIN_ALTS}** to **${MAX_ALTS}**.` };
  }
  const date = opts.activityDate?.trim() || activityDate(opts.clan);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Date must be YYYY-MM-DD." };
  }

  const [row] = await db
    .insert(altDailyLogsTable)
    .values({
      guildId: opts.clan.guildId,
      userId: opts.userId,
      username: opts.username,
      displayName: opts.displayName,
      activityDate: date,
      altCount: count,
      recordedBy: opts.recordedBy,
      recordedByUsername: opts.recordedByUsername,
      note: opts.note?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [
        altDailyLogsTable.guildId,
        altDailyLogsTable.userId,
        altDailyLogsTable.activityDate,
      ],
      set: {
        altCount: count,
        username: opts.username,
        displayName: opts.displayName,
        recordedBy: opts.recordedBy,
        recordedByUsername: opts.recordedByUsername,
        note: opts.note?.trim() || null,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) return { ok: false, error: "Could not save alt count." };
  scheduleAltBoardRefresh(opts.clan.guildId);
  return { ok: true, row, date };
}

export async function allTimeAltTotals(
  guildId: string
): Promise<Array<{ userId: string; username: string; displayName: string; total: number }>> {
  const rows = await db
    .select({
      userId: altDailyLogsTable.userId,
      username: sql<string>`max(${altDailyLogsTable.username})`,
      displayName: sql<string>`max(${altDailyLogsTable.displayName})`,
      total: sql<number>`sum(${altDailyLogsTable.altCount})::int`,
    })
    .from(altDailyLogsTable)
    .where(eq(altDailyLogsTable.guildId, guildId))
    .groupBy(altDailyLogsTable.userId)
    .orderBy(desc(sql`sum(${altDailyLogsTable.altCount})`))
    .limit(25);
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    total: Number(r.total) || 0,
  }));
}

export async function dayAltTotals(
  guildId: string,
  activityDate: string
): Promise<Array<{ userId: string; username: string; displayName: string; total: number }>> {
  const rows = await db
    .select()
    .from(altDailyLogsTable)
    .where(
      and(
        eq(altDailyLogsTable.guildId, guildId),
        eq(altDailyLogsTable.activityDate, activityDate)
      )
    )
    .orderBy(desc(altDailyLogsTable.altCount))
    .limit(25);
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    total: r.altCount,
  }));
}

async function avatarFor(
  client: Client,
  guildId: string,
  userId: string
): Promise<{ avatarUrl: string | null; robloxAvatarUrl: string | null; discordAvatarUrl: string | null }> {
  const member = await getMember(guildId, userId);
  const user = await client.users.fetch(userId).catch(() => null);
  const discord =
    user?.displayAvatarURL({ size: 256, extension: "png" }) ?? member?.avatarUrl ?? null;
  const roblox = member?.robloxAvatarUrl ?? null;
  return {
    avatarUrl: roblox || discord,
    robloxAvatarUrl: roblox,
    discordAvatarUrl: discord,
  };
}

export async function buildAltLeaderboardPayload(
  client: Client,
  clan: Clan,
  mode: "today" | "alltime" = "alltime"
): Promise<MessageCreateOptions> {
  const date = activityDate(clan);
  const ranked =
    mode === "today"
      ? await dayAltTotals(clan.guildId, date)
      : await allTimeAltTotals(clan.guildId);

  const rows = [];
  for (let i = 0; i < Math.min(ranked.length, 10); i++) {
    const r = ranked[i]!;
    const av = await avatarFor(client, clan.guildId, r.userId);
    rows.push({
      rank: i + 1,
      username: r.username,
      displayName: r.displayName || r.username,
      avatarUrl: av.avatarUrl,
      robloxAvatarUrl: av.robloxAvatarUrl,
      discordAvatarUrl: av.discordAvatarUrl,
      altCount: r.total,
    });
  }
  const podium = rows.slice(0, 3);
  const allTimeHigh = ranked[0]?.total ?? 0;

  let files: AttachmentBuilder[] | undefined;
  try {
    const png = await renderOffThread("altLeaderboardCard", {
      communityName: clan.clanName,
      mode,
      activityDate: date,
      allTimeHigh,
      podium,
      rows,
    });
    files = [new AttachmentBuilder(png, { name: "alt-leaderboard.png" })];
  } catch (err) {
    logger.warn({ err, guildId: clan.guildId }, "altLeaderboardCard render failed");
  }

  const title =
    mode === "today"
      ? `🛡️ Alt Board · Today (${date})`
      : "🛡️ Alt Board · All-Time";
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(title)
    .setDescription(
      ranked.length
        ? `Top Patriots & Guardians by alts completed.\n🏆 All-time high: **${allTimeHigh}**`
        : "No alt submissions yet — hit **Submit** to log today's count (1–100)."
    )
    .setFooter({ text: "Independent of warnings · officers can /alts set for backfill" })
    .setTimestamp();
  if (files?.length) embed.setImage("attachment://alt-leaderboard.png");

  const components = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ALT_SUBMIT)
        .setLabel("Submit alts")
        .setEmoji("📝")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(ALT_LEADERBOARD_REFRESH)
        .setLabel(mode === "today" ? "Show all-time" : "Show today")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];

  return { embeds: [embed], files, components };
}

/** Mini durable submit panel (button-first). */
export function altSubmitPanelPayload(): MessageCreateOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x1abc9c)
        .setTitle("🛡️ Patriot / Guardian Alt Log")
        .setDescription(
          "How many **alt accounts** did you finish for the clan today?\n\n" +
            "Press **Submit alts**, enter a number **1–100**, and you're on the board.\n" +
            "Linked Roblox avatars show on the leaderboard podium."
        )
        .setFooter({ text: "Not tied to warnings · staff can edit with /alts set" }),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(ALT_SUBMIT)
          .setLabel("Submit alts")
          .setEmoji("📝")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(ALT_LEADERBOARD_REFRESH)
          .setLabel("Leaderboard")
          .setEmoji("🏆")
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

export async function getAltDashboard(guildId: string) {
  const [row] = await db
    .select()
    .from(dashboardsTable)
    .where(and(eq(dashboardsTable.guildId, guildId), eq(dashboardsTable.type, DASH_TYPE)));
  return row
    ? { guildId: row.guildId, channelId: row.channelId, messageId: row.messageId }
    : null;
}

async function saveAltDashboard(guildId: string, channelId: string, messageId: string) {
  await db
    .insert(dashboardsTable)
    .values({ guildId, type: DASH_TYPE, channelId, messageId })
    .onConflictDoUpdate({
      target: [dashboardsTable.guildId, dashboardsTable.type],
      set: { channelId, messageId, updatedAt: new Date() },
    });
}

export async function postAltBoard(
  clan: Clan,
  channelId: string
): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const client = altClient;
  if (!client) return { ok: false, reason: "Bot is still starting — try again in a moment." };

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    channel = null;
  }
  if (!channel?.isTextBased() || !("send" in channel)) {
    return { ok: false, reason: `<#${channelId}> isn't a text channel I can post in.` };
  }
  if ("permissionsFor" in channel && "guild" in channel) {
    try {
      const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
      const perms = channel.permissionsFor(me);
      const missing: string[] = [];
      if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push("View Channel");
      if (!perms?.has(PermissionFlagsBits.SendMessages)) missing.push("Send Messages");
      if (!perms?.has(PermissionFlagsBits.EmbedLinks)) missing.push("Embed Links");
      if (missing.length) {
        return { ok: false, reason: `Missing **${missing.join(", ")}** in <#${channelId}>.` };
      }
    } catch {
      /* fall through */
    }
  }

  // Submit panel + leaderboard as two messages; dashboard tracks the leaderboard.
  await channel.send(altSubmitPanelPayload());
  const payload = await buildAltLeaderboardPayload(client, clan, "alltime");
  try {
    const msg = await channel.send(payload);
    await saveAltDashboard(clan.guildId, channelId, msg.id);
    return { ok: true, messageId: msg.id };
  } catch (err) {
    logger.warn({ err, guildId: clan.guildId, channelId }, "Failed to post alt board");
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

const pending = new Map<string, { timer: NodeJS.Timeout; first: number; mode: "today" | "alltime" }>();

export function scheduleAltBoardRefresh(
  guildId: string,
  mode: "today" | "alltime" = "alltime"
): void {
  if (!altClient) return;
  const now = Date.now();
  const existing = pending.get(guildId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.mode = mode;
    existing.timer = setTimeout(() => {
      pending.delete(guildId);
      void doAltRefresh(guildId, existing.mode);
    }, 1500);
    return;
  }
  pending.set(guildId, {
    first: now,
    mode,
    timer: setTimeout(() => {
      pending.delete(guildId);
      void doAltRefresh(guildId, mode);
    }, 1500),
  });
}

async function doAltRefresh(guildId: string, mode: "today" | "alltime"): Promise<void> {
  const client = altClient;
  if (!client) return;
  const dash = await getAltDashboard(guildId);
  if (!dash?.messageId) return;
  const { getClan } = await import("./config");
  const clan = await getClan(guildId);
  if (!clan) return;
  try {
    const ch = await client.channels.fetch(dash.channelId);
    if (!ch?.isTextBased() || !("messages" in ch)) return;
    const payload = await buildAltLeaderboardPayload(client, clan, mode);
    await ch.messages.edit(dash.messageId, {
      ...payload,
      attachments: [],
    } as MessageEditOptions);
  } catch (err) {
    logger.warn({ err, guildId }, "alt board refresh failed");
  }
}

export async function refreshAltBoardNow(
  guildId: string,
  mode: "today" | "alltime" = "alltime"
): Promise<void> {
  const existing = pending.get(guildId);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(guildId);
  }
  await doAltRefresh(guildId, mode);
}
