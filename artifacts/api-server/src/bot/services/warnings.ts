import { db, warningsTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember, Warning } from "@workspace/db";
import { eq, and, isNull, desc, gte, sql, inArray } from "drizzle-orm";
import PQueue from "p-queue";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  type BaseMessageOptions,
  type Client,
  type Guild,
  type MessageActionRowComponentBuilder,
  type User,
} from "discord.js";
import { logger } from "../../lib/logger";
import { ensureMember, identityFromUser, getMember } from "./config";
import { logAction, sendLog, staffLog } from "./logging";
import { recordWeeklyWarning } from "./progress";
import {
  memberWarningBody,
  memberWarningDmContent,
  activityWord,
  sanitizeMemberReason,
  periodLabel,
  periodAdjective,
  staffProgressDetail,
  DISPUTE_COMMAND,
  categoryEnforcementNoun,
  enforcementEmbedAuthor,
} from "./tracking";
import { scheduleDashboardRefresh } from "./commandCenter";
import { createNotification, resolveRelated } from "./notifications";
import { renderOffThread } from "../canvas/render-pool";
import { mpClearDo } from "../ui/ids";
import { shouldHoldWarningRole, WARNING_ROLE_ACTIVE_COUNT } from "./warningRole";

/** Live check: exempt flag OR configured exempt/leave roles on the Discord member. */
export async function isImmuneFromEnforcement(
  guild: Guild,
  clan: Clan,
  userId: string,
  member?: ClanMember | null
): Promise<{ immune: boolean; reason: string }> {
  if (member?.exempt) return { immune: true, reason: "marked exempt" };
  if (member?.onLeave) return { immune: true, reason: "on leave" };

  const needRoles = clan.exemptRoleIds.length > 0 || clan.leaveRoleIds.length > 0;
  if (!needRoles) return { immune: false, reason: "" };

  const gm = await guild.members.fetch(userId).catch(() => null);
  if (!gm) return { immune: false, reason: "" };

  if (clan.exemptRoleIds.some((id) => gm.roles.cache.has(id))) {
    // Keep the DB flag in sync so dashboards / filters stay honest.
    await db
      .update(clanMembersTable)
      .set({ exempt: true })
      .where(
        and(
          eq(clanMembersTable.guildId, clan.guildId),
          eq(clanMembersTable.userId, userId),
          eq(clanMembersTable.exempt, false)
        )
      )
      .catch(() => {});
    return { immune: true, reason: "exempt role" };
  }
  if (clan.leaveRoleIds.some((id) => gm.roles.cache.has(id))) {
    await db
      .update(clanMembersTable)
      .set({ onLeave: true })
      .where(
        and(
          eq(clanMembersTable.guildId, clan.guildId),
          eq(clanMembersTable.userId, userId),
          eq(clanMembersTable.onLeave, false)
        )
      )
      .catch(() => {});
    return { immune: true, reason: "leave role" };
  }
  return { immune: false, reason: "" };
}

/**
 * Where a warning is delivered. Both default to the clan settings when
 * omitted (channel post when a warn channel is set, DM when dmOnWarn is on),
 * so callers that don't care keep the old behaviour. A slash command can pass
 * explicit flags to let the officer pick channel, DM, or both.
 */
export interface WarnDelivery {
  channel?: boolean;
  dm?: boolean;
}

export interface IssueWarningInput {
  client: Client;
  clan: Clan;
  guild: Guild;
  target: User;
  moderatorId: string;
  moderatorUsername: string;
  /**
   * Staff/audit reason — stored on the warning row and shown in staff logs.
   * May include progress fractions, reminder counts, etc.
   */
  reason: string;
  /**
   * Optional member-facing reason. When omitted, `reason` is sanitized (any
   * staff accounting is stripped) before it reaches the member.
   */
  memberReason?: string | null;
  /** Activity category this warning is about (one warning system + selectable category). */
  categoryKey?: string | null;
  categoryLabel?: string | null;
  deliver?: WarnDelivery;
}

export interface IssueWarningResult {
  warning: Warning;
  activeCount: number;
  /** True only when this warning is what turned the warning role on. */
  roleApplied: boolean;
  /** Whether the member holds the warning role after this warning. */
  warningRoleOn: boolean;
}

/**
 * Render the XP warning canvas card — member-safe, no count/threshold badge.
 * The card carries the warning number (its dispute ticket) and the reason so
 * the canvas and the embed are driven by the same data and cannot drift.
 */
async function renderWarningCardSafe(
  clan: Clan,
  target: User,
  memberReason: string,
  warningNumber: number | null,
  member?: ClanMember | null,
  categoryLabel?: string | null
): Promise<Buffer | null> {
  try {
    const discordUrl = target.displayAvatarURL({ size: 256, extension: "png" });
    const faces = cardAvatarPair(member ?? null, discordUrl);
    return await renderOffThread("warningCard", {
      communityName: clan.clanName,
      memberName: target.username,
      avatarUrl: faces.primaryAvatarUrl,
      discordAvatarUrl: faces.discordAvatarUrl,
      robloxAvatarUrl: faces.robloxAvatarUrl,
      robloxUsername: member?.gameUsername ?? null,
      reason: memberReason,
      warningNumber,
      disputeCommand: DISPUTE_COMMAND,
      categoryLabel: categoryLabel ?? null,
      activityName: activityWord(clan),
      clanLogoUrl: clan.clanLogoUrl ?? null,
      // Intentionally omit count/threshold — those are staff-only.
    });
  } catch (err) {
    logger.warn({ err }, "Warning card render failed — falling back to embed");
    return null;
  }
}

/** A fresh attachment for each send — Buffers must not be shared across sends. */
function warningAttachment(card: Buffer): AttachmentBuilder {
  return new AttachmentBuilder(card, { name: "activity-warning.png" });
}

/**
 * Member-facing fallback embed — warning + reason + how to dispute. The warning
 * number is surfaced in the footer as the dispute ticket.
 * Discord embeds only support one thumbnail: Roblox face when linked, Discord
 * in the author icon so both identities still show.
 */
function memberWarningEmbed(
  guildName: string,
  target: User,
  memberReason: string,
  warningNumber: number | null,
  faces?: { discordAvatarUrl: string | null; robloxAvatarUrl: string | null },
  categoryLabel?: string | null
): EmbedBuilder {
  const discordUrl = faces?.discordAvatarUrl || target.displayAvatarURL({ size: 256, extension: "png" });
  const robloxUrl = faces?.robloxAvatarUrl || null;
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setAuthor({
      name: enforcementEmbedAuthor("warning", categoryLabel, guildName),
      iconURL: discordUrl || undefined,
    })
    .setThumbnail(robloxUrl || discordUrl || null)
    .setDescription(memberWarningBody(memberReason, warningNumber, categoryLabel))
    .setTimestamp();
  if (warningNumber) embed.setFooter({ text: `Warning ticket #${warningNumber} · dispute with ${DISPUTE_COMMAND}` });
  return embed;
}

/** Issue a warning: record it, bump the count, assign roles, log, optionally DM. */
export async function issueWarning(input: IssueWarningInput): Promise<IssueWarningResult> {
  const { client, clan, guild, target } = input;

  await ensureMember(guild.id, identityFromUser(target));
  const earlyMember = await getMember(guild.id, target.id);
  const immune = await isImmuneFromEnforcement(guild, clan, target.id, earlyMember);
  if (immune.immune) {
    throw new Error(
      `${target.username} is immune (${immune.reason}) — warning not issued.`
    );
  }

  const memberFacingReason = sanitizeMemberReason(input.memberReason ?? input.reason);
  // Persist the staff reason (full accounting) on the row for audits / officer views.
  const staffReason = input.reason.trim() || memberFacingReason;

  const [warning] = await db
    .insert(warningsTable)
    .values({
      guildId: guild.id,
      userId: target.id,
      username: target.username,
      avatarUrl: target.displayAvatarURL(),
      issuedBy: input.moderatorId,
      issuedByUsername: input.moderatorUsername,
      reason: staffReason,
      categoryKey: input.categoryKey ?? null,
      categoryLabel: input.categoryLabel ?? null,
    })
    .returning();

  await db
    .update(clanMembersTable)
    .set({
      warningsCount: sql`${clanMembersTable.warningsCount} + 1`,
      // Lifetime never rolls back on remove — officers need the full history.
      lifetimeWarnings: sql`${clanMembersTable.lifetimeWarnings} + 1`,
      // A warning resets the clean-standing run.
      cleanPoints: 0,
    })
    .where(and(eq(clanMembersTable.guildId, guild.id), eq(clanMembersTable.userId, target.id)));

  // XP-enforcement bookkeeping: count this warning against the current period.
  await recordWeeklyWarning(clan, target.id);

  const activeCount = await countActive(guild.id, target.id);
  const memberRow = await getMember(guild.id, target.id);
  const staffDetail = memberRow ? staffProgressDetail(clan, memberRow) : null;
  const faces = cardAvatarPair(
    memberRow,
    target.displayAvatarURL({ size: 256, extension: "png" })
  );

  const roleState = await syncWarningRole({
    guild,
    clan,
    userId: target.id,
    username: target.username,
    activeCount,
    actorId: input.moderatorId,
    actorUsername: input.moderatorUsername,
  });

  const deliverChannel = input.deliver?.channel ?? true;
  const deliverDm = input.deliver?.dm ?? clan.dmOnWarn;
  let channelPosted = false;
  let dmSent = false;

  const warningNumber = warning?.id ?? null;

  const categoryLabel = input.categoryLabel ?? null;

  // Member-facing card: no warning-count badge, no escalation threshold.
  const card =
    clan.cardStyle === "embed"
      ? null
      : await renderWarningCardSafe(
          clan,
          target,
          memberFacingReason,
          warningNumber,
          memberRow,
          categoryLabel
        );

  const noun = categoryEnforcementNoun(categoryLabel);

  // Post to the dedicated warning channel when one is configured. This is a
  // MEMBER-facing surface — never include staff accounting.
  if (deliverChannel && clan.warningChannelId) {
    try {
      const channel = await client.channels.fetch(clan.warningChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        const fallbackEmbed = memberWarningEmbed(
          guild.name,
          target,
          memberFacingReason,
          warningNumber,
          faces,
          categoryLabel
        );
        const ping =
          `⚠️ <@${target.id}> — you missed your ${noun}. This is a warning` +
          `${warningNumber ? ` (ticket **#${warningNumber}**)` : ""}. ` +
          `If this is wrong, run \`${DISPUTE_COMMAND}\`.`;
        if (card) {
          const { asCanvasHubV2 } = await import("../ui/v2/hubChrome");
          const { V2_ACCENT } = await import("../ui/v2/primitives");
          await channel.send({
            content: ping,
            allowedMentions: { users: [target.id] },
          });
          await channel.send(
            asCanvasHubV2(
              { files: [warningAttachment(card)] },
              { title: "Activity warning", accent: V2_ACCENT.danger }
            )
          );
        } else {
          const { warningNoticeV2 } = await import("../ui/v2/commonPanels");
          await channel.send({
            content: ping,
            allowedMentions: { users: [target.id] },
          });
          await channel.send(
            warningNoticeV2({
              title: "Activity warning",
              body: fallbackEmbed.data.description ?? memberFacingReason,
              footer: warningNumber
                ? `Warning ticket #${warningNumber} · dispute with ${DISPUTE_COMMAND}`
                : null,
            })
          );
        }
        channelPosted = true;
      }
    } catch (err) {
      logger.warn({ err, channel: clan.warningChannelId }, "Warning channel post failed");
    }
  }

  if (deliverDm) {
    const dmEmbed = memberWarningEmbed(
      guild.name,
      target,
      memberFacingReason,
      warningNumber,
      faces,
      categoryLabel
    );
    try {
      await target.send({
        content: memberWarningDmContent(memberFacingReason, warningNumber, categoryLabel),
      });
      if (card) {
        const { asCanvasHubV2 } = await import("../ui/v2/hubChrome");
        const { V2_ACCENT } = await import("../ui/v2/primitives");
        await target.send(
          asCanvasHubV2(
            { files: [warningAttachment(card)] },
            { title: "Activity warning", accent: V2_ACCENT.danger }
          )
        );
      } else {
        const { warningNoticeV2 } = await import("../ui/v2/commonPanels");
        await target.send(
          warningNoticeV2({
            title: "Activity warning",
            body: dmEmbed.data.description ?? memberFacingReason,
            footer: warningNumber
              ? `Warning ticket #${warningNumber} · dispute with ${DISPUTE_COMMAND}`
              : null,
          })
        );
      }
      dmSent = true;
    } catch {
      dmSent = false;
    }
  }

  const delivery =
    [channelPosted ? "warn channel" : null, dmSent ? "DM" : null].filter(Boolean).join(" + ") ||
    (deliverChannel || deliverDm ? "not delivered" : "silent");

  // Audit row (DB) — durable staff record of who warned whom, with accounting.
  await logAction(guild.id, {
    action: "warning_issued",
    targetUserId: target.id,
    targetUsername: target.username,
    moderatorId: input.moderatorId,
    moderatorUsername: input.moderatorUsername,
    details: {
      reason: staffReason,
      memberReason: memberFacingReason,
      warningId: warning?.id,
      activeCount,
      delivery,
      period: periodAdjective(clan),
      progress: staffDetail?.progress ?? null,
      requirement: staffDetail?.requirement ?? null,
      missing: staffDetail?.missing ?? null,
      remindersThisPeriod: staffDetail?.remindersThisPeriod ?? null,
      escalationThreshold: clan.escalationThreshold,
    },
  });

  // Full staff log embed — CAN include progress / accounting.
  const staffFields = [
    { name: "Reason (staff)", value: staffReason.slice(0, 1024) },
    { name: "Active warnings", value: `${activeCount}`, inline: true },
    { name: "Delivered via", value: delivery, inline: true },
    { name: "Tracking period", value: periodLabel(clan), inline: true },
  ];
  if (staffDetail) {
    staffFields.push(
      {
        name: "Progress",
        value: `${staffDetail.progress.toLocaleString()}/${staffDetail.requirement.toLocaleString()}`,
        inline: true,
      },
      {
        name: "Missing",
        value: `${staffDetail.missing.toLocaleString()}`,
        inline: true,
      },
      {
        name: "Reminders this period",
        value: `${staffDetail.remindersThisPeriod}`,
        inline: true,
      }
    );
  }

  await sendLog(
    client,
    clan,
    new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: `Warning issued • ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(`<@${target.id}> was warned by <@${input.moderatorId}>.`)
      .addFields(...staffFields)
      .setFooter({ text: `Moderator: ${input.moderatorUsername} · ${input.moderatorId}` })
      .setTimestamp()
  );

  logger.info(
    {
      event: "warning_issued",
      guildId: guild.id,
      warningId: warning?.id,
      targetId: target.id,
      targetUsername: target.username,
      moderatorId: input.moderatorId,
      moderatorUsername: input.moderatorUsername,
      activeCount,
      channelPosted,
      dmSent,
      period: periodAdjective(clan),
      progress: staffDetail?.progress ?? null,
      requirement: staffDetail?.requirement ?? null,
    },
    `Warning issued to ${target.username} by ${input.moderatorUsername} (active: ${activeCount})`
  );

  scheduleDashboardRefresh(guild.id);

  await createNotification({
    guildId: guild.id,
    type: "warning",
    title: `Warning issued — ${target.username}`,
    body: `${staffReason.slice(0, 300)} (now ${activeCount} active)`,
    targetUserId: target.id,
    targetUsername: target.username,
    relatedId: warning?.id ?? null,
    createdBy: input.moderatorId,
    createdByUsername: input.moderatorUsername,
  });
  if (activeCount >= clan.escalationThreshold) {
    await createNotification({
      guildId: guild.id,
      type: "escalation",
      title: `Escalation — ${target.username}`,
      body: `${target.username} is at ${activeCount} active warnings (threshold ${clan.escalationThreshold}). Flag for leadership review.`,
      targetUserId: target.id,
      targetUsername: target.username,
      relatedId: warning?.id ?? null,
      createdBy: input.moderatorId,
      createdByUsername: input.moderatorUsername,
    });
  }

  return {
    warning: warning!,
    activeCount,
    roleApplied: roleState.changed && roleState.hasRole,
    warningRoleOn: roleState.hasRole,
  };
}

/**
 * Give or take the configured warning role based on active warning count.
 * The role turns on at {@link WARNING_ROLE_ACTIVE_COUNT} and comes off below that.
 */
export async function syncWarningRole(opts: {
  guild: Guild;
  clan: Clan;
  userId: string;
  username: string;
  activeCount: number;
  actorId: string;
  actorUsername: string;
}): Promise<{ hasRole: boolean; changed: boolean }> {
  const { guild, clan, userId, activeCount } = opts;
  if (!clan.warningRoleIds.length) return { hasRole: false, changed: false };

  const shouldHave = shouldHoldWarningRole(activeCount);
  const gm = await guild.members.fetch(userId).catch(() => null);
  if (!gm) return { hasRole: false, changed: false };

  const has = clan.warningRoleIds.some((id) => gm.roles.cache.has(id));
  if (shouldHave === has) return { hasRole: has, changed: false };

  if (shouldHave) {
    await gm.roles.add(clan.warningRoleIds).catch((err) => {
      logger.warn({ err, userId }, "Failed to assign warning role");
    });
  } else {
    await gm.roles.remove(clan.warningRoleIds).catch((err) => {
      logger.warn({ err, userId }, "Failed to remove warning role");
    });
  }

  const hasRole = clan.warningRoleIds.some((id) => gm.roles.cache.has(id));

  await staffLog({
    client: guild.client,
    clan,
    action: shouldHave ? "warning_role_applied" : "warning_role_removed",
    title: shouldHave ? "🔗 Warning role applied" : "✅ Warning role removed",
    description: shouldHave
      ? `<@${userId}> reached **${WARNING_ROLE_ACTIVE_COUNT}** active warnings — warning role applied by <@${opts.actorId}>.`
      : `<@${userId}> is below **${WARNING_ROLE_ACTIVE_COUNT}** active warnings — warning role removed by <@${opts.actorId}>.`,
    color: shouldHave ? 0xed4245 : 0x3ba55d,
    actorId: opts.actorId,
    actorUsername: opts.actorUsername,
    targetUserId: userId,
    targetUsername: opts.username,
    fields: [
      { name: "Active warnings", value: String(activeCount), inline: true },
      {
        name: "Roles",
        value: clan.warningRoleIds.map((r) => `<@&${r}>`).join(" ") || "—",
        inline: true,
      },
    ],
    auditDetails: {
      activeCount,
      threshold: WARNING_ROLE_ACTIVE_COUNT,
      reason: shouldHave ? "active_warning_threshold" : "below_active_warning_threshold",
    },
  });

  return { hasRole, changed: true };
}

/**
 * The most recent active warning for a member issued within `windowMs`, or
 * null. Used to stop the same member being warned (and pinged) twice in quick
 * succession by stacked commands or a slip of the finger.
 *
 * When `categoryKey` is set, only warnings for that same activity category
 * count — switching from XP to Combat Support is a brand-new warning window.
 */
export async function recentWarning(
  guildId: string,
  userId: string,
  windowMs = 20 * 3600_000,
  categoryKey?: string | null
): Promise<Warning | null> {
  const cutoff = new Date(Date.now() - windowMs);
  const filters = [
    eq(warningsTable.guildId, guildId),
    eq(warningsTable.userId, userId),
    isNull(warningsTable.removedAt),
    gte(warningsTable.issuedAt, cutoff),
  ];
  if (categoryKey) {
    filters.push(eq(warningsTable.categoryKey, categoryKey));
  }
  const [row] = await db
    .select()
    .from(warningsTable)
    .where(and(...filters))
    .orderBy(desc(warningsTable.issuedAt))
    .limit(1);
  return row ?? null;
}

export interface BulkWarnResult {
  issued: number;
  skipped: number;
  escalated: string[];
}

/**
 * Warn many members with Discord-safe pacing. Mirrors sendBulkReminders so a
 * role-wide `/xp role warn` behaves like the single-member `/xp warn`. Members
 * whose account can't be fetched are skipped. Anyone who crosses the clan's
 * escalation threshold is returned so the caller can flag them for leadership.
 * When `skipIfWarnedRecently` is set, members already warned in the last 20
 * hours are skipped so stacked commands can't double-ping anyone.
 */
export async function sendBulkWarnings(opts: {
  client: Client;
  clan: Clan;
  guild: Guild;
  targets: ClanMember[];
  moderatorId: string;
  moderatorUsername: string;
  /** Staff/audit reason builder — may include accounting. */
  reason: (member: ClanMember) => string;
  /** Optional member-facing reason builder — sanitized if omitted. */
  memberReason?: (member: ClanMember) => string;
  deliver?: WarnDelivery;
  skipIfWarnedRecently?: boolean;
}): Promise<BulkWarnResult> {
  const { client, clan, guild, targets } = opts;
  const queue = new PQueue({ concurrency: 2, intervalCap: 2, interval: 1000 });
  let issued = 0;
  let skipped = 0;
  const escalated: string[] = [];
  for (const member of targets) {
    queue.add(async () => {
      if (opts.skipIfWarnedRecently && (await recentWarning(clan.guildId, member.userId))) {
        skipped++;
        return;
      }
      const user = await client.users.fetch(member.userId).catch(() => null);
      if (!user) return;
      const { activeCount } = await issueWarning({
        client,
        clan,
        guild,
        target: user,
        moderatorId: opts.moderatorId,
        moderatorUsername: opts.moderatorUsername,
        reason: opts.reason(member),
        memberReason: opts.memberReason?.(member) ?? null,
        deliver: opts.deliver,
      });
      issued++;
      if (activeCount >= clan.escalationThreshold) {
        escalated.push(`<@${member.userId}> (${activeCount})`);
      }
    });
  }
  await queue.onIdle();
  return { issued, skipped, escalated };
}

/**
 * Post a single warning announcement that pings a whole role, without issuing
 * per-member warnings. Used by `/xp role warn` in "announce" mode. Member-
 * facing — reason is sanitized before posting.
 */
export async function postWarningAnnouncement(opts: {
  client: Client;
  clan: Clan;
  roleId: string;
  reason: string;
  moderatorUsername: string;
}): Promise<boolean> {
  const { client, clan } = opts;
  if (!clan.warningChannelId) return false;
  try {
    const channel = await client.channels.fetch(clan.warningChannelId);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: `⚠️ WARNING • ${clan.clanName}` })
      .setDescription(memberWarningBody(opts.reason, null, clan.activityName))
      .setTimestamp();
    await channel.send({
      content: `⚠️ <@&${opts.roleId}>`,
      embeds: [embed],
      allowedMentions: { roles: [opts.roleId] },
    });
    return true;
  } catch (err) {
    logger.warn({ err, channel: clan.warningChannelId }, "Warning announcement post failed");
    return false;
  }
}

export async function countActive(guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
        isNull(warningsTable.removedAt)
      )
    );
  return row?.count ?? 0;
}

export interface EnforcementRankRow {
  userId: string;
  username: string;
  /** Lifetime rows (warnings include removed ones). */
  count: number;
  /** Still-active warnings. Reminders leave this equal to count. */
  active: number;
}

/**
 * Who has the most saved warnings. Lifetime count includes removed rows so
 * past warnings still rank. `active` is the subset that has not been cleared.
 * When `userIds` is set, only those people are ranked — the warning board
 * passes the members who currently hold the activity track role.
 */
export async function rankByWarnings(
  guildId: string,
  limit = 10,
  userIds?: string[],
  mode: "active" | "lifetime" = "lifetime"
): Promise<EnforcementRankRow[]> {
  if (userIds && userIds.length === 0) return [];

  // Active board: only rows that are still open. Lifetime: every saved warning.
  const scope =
    mode === "active"
      ? and(eq(warningsTable.guildId, guildId), isNull(warningsTable.removedAt))
      : eq(warningsTable.guildId, guildId);
  const where = userIds ? and(scope, inArray(warningsTable.userId, userIds)) : scope;

  const rows = await db
    .select({
      userId: warningsTable.userId,
      username: sql<string>`max(${warningsTable.username})`,
      count: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(warningsTable)
    .where(where)
    .groupBy(warningsTable.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  if (mode === "active") {
    // Every counted row is active in this mode.
    return rows.map((r) => ({
      userId: r.userId,
      username: r.username || "member",
      count: Number(r.count) || 0,
      active: Number(r.count) || 0,
    }));
  }

  // Lifetime still needs an active subtotal for the "(N still active)" note.
  const rankedIds = rows.map((r) => r.userId);
  const activeByUser = new Map<string, number>();
  if (rankedIds.length) {
    const activeRows = await db
      .select({
        userId: warningsTable.userId,
        active: sql<number>`count(*)::int`.mapWith(Number),
      })
      .from(warningsTable)
      .where(
        and(
          eq(warningsTable.guildId, guildId),
          isNull(warningsTable.removedAt),
          inArray(warningsTable.userId, rankedIds)
        )
      )
      .groupBy(warningsTable.userId);
    for (const r of activeRows) activeByUser.set(r.userId, Number(r.active) || 0);
  }

  return rows.map((r) => ({
    userId: r.userId,
    username: r.username || "member",
    count: Number(r.count) || 0,
    active: activeByUser.get(r.userId) ?? 0,
  }));
}

/** Lifetime warnings (active + removed) — the history officers review. */
export async function countLifetime(guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.userId, userId)));
  return row?.count ?? 0;
}

export async function listActive(guildId: string, userId: string): Promise<Warning[]> {
  return db
    .select()
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
        isNull(warningsTable.removedAt)
      )
    )
    .orderBy(desc(warningsTable.issuedAt));
}

/** Full warning history for a member (newest first). Includes soft-removed rows. */

export interface WarningCategoryCount {
  key: string;
  label: string;
  count: number;
}

/** Active warnings grouped by activity category (for the player card). */
export async function warningBreakdownByCategory(
  guildId: string,
  userId: string
): Promise<WarningCategoryCount[]> {
  const rows = await db
    .select({
      categoryKey: warningsTable.categoryKey,
      categoryLabel: warningsTable.categoryLabel,
      count: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
        isNull(warningsTable.removedAt)
      )
    )
    .groupBy(warningsTable.categoryKey, warningsTable.categoryLabel);

  return rows
    .map((r) => ({
      key: r.categoryKey || "activity",
      label: r.categoryLabel || "Activity",
      count: r.count,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function listHistory(
  guildId: string,
  userId: string,
  limit = 25
): Promise<Warning[]> {
  return db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.userId, userId)))
    .orderBy(desc(warningsTable.issuedAt))
    .limit(limit);
}

/** Prefer the linked Roblox avatar on member-facing cards when an officer assigned one. */
export function cardAvatarUrl(member: ClanMember | null | undefined, discordUrl: string | null): string | null {
  return member?.robloxAvatarUrl || discordUrl || member?.avatarUrl || null;
}

/** Discord + linked Roblox faces for dual-avatar cards (standing / warning / reminder / board). */
export function cardAvatarPair(
  member: ClanMember | null | undefined,
  discordUrl: string | null
): {
  discordAvatarUrl: string | null;
  robloxAvatarUrl: string | null;
  /** Primary face for single-avatar layouts: Roblox when linked, else Discord. */
  primaryAvatarUrl: string | null;
} {
  const discord = discordUrl || member?.avatarUrl || null;
  const roblox = member?.robloxAvatarUrl ?? null;
  return {
    discordAvatarUrl: discord,
    robloxAvatarUrl: roblox,
    primaryAvatarUrl: roblox || discord,
  };
}

export interface RemoveWarningInput {
  guild: Guild;
  clan: Clan;
  warningId: number;
  moderatorId: string;
  moderatorUsername: string;
}

export async function removeWarning(input: RemoveWarningInput): Promise<Warning | null> {
  const { guild, clan, warningId } = input;
  const [warning] = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.id, warningId), eq(warningsTable.guildId, guild.id)));
  if (!warning || warning.removedAt) return null;

  await db
    .update(warningsTable)
    .set({ removedAt: new Date(), removedBy: input.moderatorId })
    .where(eq(warningsTable.id, warningId));

  await db
    .update(clanMembersTable)
    .set({ warningsCount: sql`greatest(${clanMembersTable.warningsCount} - 1, 0)` })
    .where(and(eq(clanMembersTable.guildId, guild.id), eq(clanMembersTable.userId, warning.userId)));

  const activeCount = await countActive(guild.id, warning.userId);

  await syncWarningRole({
    guild,
    clan,
    userId: warning.userId,
    username: warning.username,
    activeCount,
    actorId: input.moderatorId,
    actorUsername: input.moderatorUsername,
  });

  await staffLog({
    client: guild.client,
    clan,
    action: "warning_removed",
    title: "✅ Warning removed",
    description: `<@${input.moderatorId}> removed a warning from <@${warning.userId}>.`,
    color: 0x3ba55d,
    actorId: input.moderatorId,
    actorUsername: input.moderatorUsername,
    targetUserId: warning.userId,
    targetUsername: warning.username,
    fields: [
      { name: "Warning ID", value: String(warningId), inline: true },
      { name: "Active remaining", value: String(activeCount), inline: true },
    ],
    auditDetails: { warningId, activeCount },
  });

  scheduleDashboardRefresh(guild.id);
  await resolveRelated(guild.id, "warning", warningId);
  await resolveRelated(guild.id, "escalation", warningId);
  await notifyWarningCleared(guild, clan, warning, activeCount).catch((err) => {
    logger.warn({ err, warningId }, "Cleared-warning notice failed");
  });

  return warning;
}

/**
 * Retired. Warnings and the warning role are not on a timer.
 * The role turns on at 2 active warnings and comes off when staff clear below that.
 */
export async function autoExpireWarnings(_client: Client, _clan: Clan): Promise<number> {
  return 0;
}

/**
 * Retired. Meeting an activity goal does not lift the warning role.
 * Staff clear warnings, usually after a dispute.
 */
export async function clearWarningRolesForSatisfiedMembers(
  _client: Client,
  _clan: Clan
): Promise<number> {
  return 0;
}

/** Retired. Activity progress does not remove the warning role. */
export async function clearWarningRoleIfRequirementMet(
  _guild: Guild,
  _clan: Clan,
  _userId: string
): Promise<boolean> {
  return false;
}


/** Tell the member their warning is off the active list. Roblox face, else Discord. */
async function notifyWarningCleared(
  guild: Guild,
  clan: Clan,
  warning: Warning,
  activeCount: number
): Promise<void> {
  const member = await getMember(guild.id, warning.userId);
  const user = await guild.client.users.fetch(warning.userId).catch(() => null);
  const discordUrl =
    user?.displayAvatarURL({ size: 256, extension: "png" }) ?? member?.avatarUrl ?? null;
  const faces = cardAvatarPair(member, discordUrl);
  const embed = new EmbedBuilder()
    .setColor(0x3ba55d)
    .setAuthor({
      name: `Warning cleared · ${warning.username}`,
      iconURL: faces.discordAvatarUrl ?? undefined,
    })
    .setThumbnail(faces.primaryAvatarUrl)
    .setDescription(
      `Warning **#${warning.id}** is no longer active.` +
        (warning.categoryLabel ? `\nIt was about **${warning.categoryLabel}**.` : "")
    )
    .addFields(
      {
        name: "What it said",
        value: sanitizeMemberReason(warning.reason).slice(0, 1024) || "—",
      },
      { name: "Active warnings left", value: String(activeCount), inline: true }
    )
    .setTimestamp();

  if (user) {
    try {
      await user.send({ embeds: [embed] });
      return;
    } catch {
      // DMs closed — fall through to the warning channel.
    }
  }
  if (!clan.warningChannelId) return;
  const channel = await guild.client.channels.fetch(clan.warningChannelId).catch(() => null);
  if (channel?.isTextBased() && "send" in channel) {
    await channel.send({
      content: `<@${warning.userId}>`,
      embeds: [embed],
      allowedMentions: { users: [warning.userId] },
    });
  }
}

/**
 * Live staff embed of a member's active warnings, with a button that clears
 * each one immediately. The reply is edited in place after a clear.
 */
export async function clearWarningPanel(
  guild: Guild,
  clan: Clan,
  userId: string
): Promise<BaseMessageOptions> {
  const [warns, member] = await Promise.all([
    listActive(guild.id, userId),
    getMember(guild.id, userId),
  ]);
  const user = await guild.client.users.fetch(userId).catch(() => null);
  const discordUrl =
    user?.displayAvatarURL({ size: 256, extension: "png" }) ?? member?.avatarUrl ?? null;
  const faces = cardAvatarPair(member, discordUrl);
  const name = member?.displayName || member?.username || user?.username || "Member";

  if (!warns.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x3ba55d)
          .setAuthor({ name: `${name} — active warnings`, iconURL: faces.discordAvatarUrl ?? undefined })
          .setThumbnail(faces.primaryAvatarUrl)
          .setDescription(`<@${userId}> has no active warnings.`),
      ],
      components: [],
    };
  }

  const shown = warns.slice(0, 5);
  const roleLine = clan.warningRoleIds.length
    ? `\nThe warning role turns on at **${WARNING_ROLE_ACTIVE_COUNT}** active warnings` +
      (shouldHoldWarningRole(warns.length) ? " and is on now." : " and is off right now.")
    : "";

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setAuthor({ name: `${name} — active warnings`, iconURL: faces.discordAvatarUrl ?? undefined })
    .setThumbnail(faces.primaryAvatarUrl)
    .setDescription(
      `**${warns.length}** active. These stay until staff clear them — usually after the member opens **/dispute** and uploads evidence in the ticket.` +
        roleLine +
        (warns.length > shown.length ? `\n\nShowing the newest ${shown.length}. Clear one to see the rest.` : "")
    )
    .addFields(
      shown.map((w) => ({
        name: `#${w.id}${w.categoryLabel ? ` · ${w.categoryLabel}` : ""}`,
        value: sanitizeMemberReason(w.reason).slice(0, 200) || "—",
      }))
    );

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    shown.map((w) =>
      new ButtonBuilder()
        .setCustomId(mpClearDo(w.id))
        .setLabel(`Clear #${w.id}`)
        .setStyle(ButtonStyle.Danger)
    )
  );

  return { embeds: [embed], components: [row] };
}
