/**
 * /warnboard — a plain ranked list, 10 people per page.
 * Counts come from saved warning and reminder rows, not clan points.
 * Only members who currently hold the configured activity track role are listed.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type Guild,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import { rankByWarnings, type EnforcementRankRow } from "../services/warnings";
import { rankByReminders } from "../services/reminders";
import { memberIdsWithRoles } from "../services/roles";
import { activityWord } from "../services/tracking";
import { warnBoardAudience } from "./warnBoardAudience";
import { DASH_HOME, dashBoardPage } from "../ui/ids";

const PAGE_SIZE = 10;
const FETCH_CAP = 100;

export type WarnBoardView = "active" | "lifetime";

/** `dash:board`, `dash:board:2` (legacy), or `dash:board:active-2` / `life-2`. */
export function parseWarnBoardArg(arg?: string | null): { view: WarnBoardView; page: number } {
  if (!arg || /^\d+$/.test(arg)) {
    return { view: "active", page: Math.max(0, parseInt(arg ?? "0", 10) || 0) };
  }
  const [viewRaw, pageRaw] = arg.split("-");
  const view: WarnBoardView = viewRaw === "life" || viewRaw === "lifetime" ? "lifetime" : "active";
  return { view, page: Math.max(0, parseInt(pageRaw ?? "0", 10) || 0) };
}

interface Listed {
  rank: number;
  name: string;
  count: number;
  note: string;
}

function displayName(userId: string, username: string, names: Map<string, string>): string {
  const name = (names.get(userId) || username || "member").replace(/\s+/g, " ").trim();
  return name.slice(0, 32) || "member";
}

function lines(rows: Listed[], empty: string): string {
  if (!rows.length) return empty;
  return rows.map((r) => `${r.rank}. ${r.name}: ${r.count}${r.note}`).join("\n");
}

function pager(
  page: number,
  pages: number,
  view: WarnBoardView
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(dashBoardPage(0, "active"))
        .setStyle(view === "active" ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setLabel("Active")
        .setDisabled(view === "active"),
      new ButtonBuilder()
        .setCustomId(dashBoardPage(0, "lifetime"))
        .setStyle(view === "lifetime" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setLabel("Lifetime")
        .setDisabled(view === "lifetime"),
      new ButtonBuilder().setCustomId(DASH_HOME).setStyle(ButtonStyle.Secondary).setLabel("Overview")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(dashBoardPage(page - 1, view))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("◀ Prev")
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(dashBoardPage(page + 1, view))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Next ▶")
        .setDisabled(page >= pages - 1)
    ),
  ];
}

function boardNotice(clan: Clan, message: string): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`${clan.clanName} — warnings & reminders`)
    .setDescription(message);
  return {
    content: "",
    embeds: [embed],
    files: [],
    components: pager(0, 1, "active"),
  };
}

/** Plain embed shared by /warnboard and the Command Center button. */
export async function buildWarnBoardPayload(
  clan: Clan,
  page = 0,
  guild?: Guild | null,
  view: WarnBoardView = "active"
): Promise<BaseMessageOptions> {
  if (!clan.requiredRoleId) {
    return boardNotice(
      clan,
      "Set the activity track role in /setup. This board only lists people who have that role right now."
    );
  }
  if (!guild) {
    return boardNotice(clan, "Open this board inside the server so the activity track role can be read.");
  }

  const memberIds = await memberIdsWithRoles(guild, [clan.requiredRoleId]);
  const role = guild.roles.cache.get(clan.requiredRoleId);
  const audience = warnBoardAudience({
    requiredRoleId: clan.requiredRoleId,
    roleOnServer: !!role,
    memberIds,
  });
  if (!audience.ok) return boardNotice(clan, audience.message);

  const names = new Map<string, string>();
  if (role) {
    for (const member of role.members.values()) {
      if (!member.user.bot) names.set(member.id, member.displayName || member.user.username);
    }
  }

  const [warned, reminded] = await Promise.all([
    rankByWarnings(clan.guildId, FETCH_CAP, audience.memberIds, view),
    rankByReminders(clan.guildId, FETCH_CAP, audience.memberIds),
  ]);
  const warnedRows: Listed[] = warned.map((r: EnforcementRankRow, i) => ({
    rank: i + 1,
    name: displayName(r.userId, r.username, names),
    count: view === "active" ? r.active : r.count,
    note:
      view === "active"
        ? " active"
        : r.active === r.count
          ? ""
          : ` (${r.active} still active)`,
  }));
  const remindedRows: Listed[] = reminded.map((r, i) => ({
    rank: i + 1,
    name: displayName(r.userId, r.username, names),
    count: r.count,
    note: "",
  }));

  const pages = Math.max(
    1,
    Math.ceil(warnedRows.length / PAGE_SIZE),
    Math.ceil(remindedRows.length / PAGE_SIZE)
  );
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * PAGE_SIZE;
  const activity = activityWord(clan);
  const emptyWarned = audience.memberIds.length
    ? view === "active"
      ? "_Nobody with the track role has an active warning._"
      : "_Nobody with the track role has a saved warning._"
    : "_Nobody currently has the activity track role._";
  const emptyReminded = audience.memberIds.length
    ? "_Nobody with the track role has a saved reminder._"
    : "_Nobody currently has the activity track role._";

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`${clan.clanName} — ${view === "active" ? "active warnings" : "lifetime warnings"}`)
    .setDescription(
      `Page **${current + 1}** of **${pages}** · 10 people per page\n` +
        `Only members who currently have <@&${clan.requiredRoleId}>. ` +
        (view === "active"
          ? `**Active** is who still has a warning on them. The warning role turns on at **2** active warnings.`
          : `**Lifetime** counts every warning ever saved, including ones staff already cleared.`) +
        `\nMessages are about **${activity}**. Clan points are a separate award.`
    )
    .addFields(
      {
        name: view === "active" ? "On an active warning" : "Most warned",
        value: lines(warnedRows.slice(start, start + PAGE_SIZE), emptyWarned).slice(0, 1024),
      },
      {
        name: "Most reminded",
        value: lines(remindedRows.slice(start, start + PAGE_SIZE), emptyReminded).slice(0, 1024),
      }
    )
    .setFooter({
      text:
        view === "active"
          ? "Active list. A warning stays until staff clear it."
          : "Lifetime totals. Cleared warnings still count here.",
    });

  return {
    content: "",
    embeds: [embed],
    files: [],
    components: pager(current, pages, view),
  };
}

export async function handleWarnBoard(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    const officer = isOfficer(interaction.member, null);
    await interaction.editReply({
      content: officer
        ? "This server isn't configured yet — run **/setup**."
        : "This server isn't configured yet. Ask an officer to run **/setup**.",
    });
    return;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can open the warning board." });
    return;
  }
  await interaction.editReply(await buildWarnBoardPayload(clan, 0, interaction.guild, "active"));
}
