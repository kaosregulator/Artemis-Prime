/**
 * /warnboard — a plain ranked list, 10 people per page.
 * Counts come from saved warning and reminder rows, not clan points.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { db, clanMembersTable, type Clan, type ClanMember } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getClan, isOfficer } from "../services/config";
import { rankByWarnings, type EnforcementRankRow } from "../services/warnings";
import { rankByReminders } from "../services/reminders";
import { activityWord } from "../services/tracking";
import { DASH_HOME, dashBoardPage } from "../ui/ids";

const PAGE_SIZE = 10;
const FETCH_CAP = 100;

interface Listed {
  rank: number;
  name: string;
  count: number;
  note: string;
}

function memberMap(members: ClanMember[]): Map<string, ClanMember> {
  return new Map(members.map((m) => [m.userId, m]));
}

function displayName(userId: string, username: string, members: Map<string, ClanMember>): string {
  const m = members.get(userId);
  const name = (m?.displayName || m?.username || username || "member").replace(/\s+/g, " ").trim();
  return name.slice(0, 32) || "member";
}

function lines(rows: Listed[], empty: string): string {
  if (!rows.length) return empty;
  return rows.map((r) => `${r.rank}. ${r.name}: ${r.count}${r.note}`).join("\n");
}

/** Plain embed shared by /warnboard and the Command Center button. */
export async function buildWarnBoardPayload(clan: Clan, page = 0): Promise<BaseMessageOptions> {
  const [warned, reminded, members] = await Promise.all([
    rankByWarnings(clan.guildId, FETCH_CAP),
    rankByReminders(clan.guildId, FETCH_CAP),
    db.select().from(clanMembersTable).where(eq(clanMembersTable.guildId, clan.guildId)),
  ]);
  const byId = memberMap(members);
  const warnedRows: Listed[] = warned.map((r: EnforcementRankRow, i) => ({
    rank: i + 1,
    name: displayName(r.userId, r.username, byId),
    count: r.count,
    note: r.active === r.count ? "" : ` (${r.active} still active)`,
  }));
  const remindedRows: Listed[] = reminded.map((r, i) => ({
    rank: i + 1,
    name: displayName(r.userId, r.username, byId),
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

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`${clan.clanName} — warnings & reminders`)
    .setDescription(
      `Page **${current + 1}** of **${pages}** · 10 people per page\n` +
        `These are messages about **${activity}**. Clan points are a separate award you give out.`
    )
    .addFields(
      {
        name: "Most warned",
        value: lines(warnedRows.slice(start, start + PAGE_SIZE), "_No warnings saved yet._").slice(0, 1024),
      },
      {
        name: "Most reminded",
        value: lines(remindedRows.slice(start, start + PAGE_SIZE), "_No reminders saved yet._").slice(0, 1024),
      }
    )
    .setFooter({
      text: "Number is the lifetime total. Cleared warnings still count. Clan role decides who is included.",
    });

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(dashBoardPage(current - 1))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("◀ Prev")
      .setDisabled(current <= 0),
    new ButtonBuilder()
      .setCustomId(DASH_HOME)
      .setStyle(ButtonStyle.Primary)
      .setLabel("Overview"),
    new ButtonBuilder()
      .setCustomId(dashBoardPage(current + 1))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Next ▶")
      .setDisabled(current >= pages - 1)
  );

  return {
    content: "",
    embeds: [embed],
    files: [],
    components: [row],
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
  await interaction.editReply(await buildWarnBoardPayload(clan, 0));
}
