/**
 * /warnboard — officers see who has the most saved warnings and reminders.
 * Counts come from the warning and reminder tables, not the clean-points board.
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { db, clanMembersTable, type Clan, type ClanMember } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getClan, isOfficer } from "../services/config";
import { rankByWarnings } from "../services/warnings";
import { rankByReminders } from "../services/reminders";
import { activityWord } from "../services/tracking";
import { renderOffThread } from "../canvas/render-pool";
import type { WarnBoardRow } from "../canvas/cards/warnBoardCard";
import { DASH_HOME } from "../ui/ids";

function memberMap(members: ClanMember[]): Map<string, ClanMember> {
  return new Map(members.map((m) => [m.userId, m]));
}

function present(
  rank: number,
  userId: string,
  username: string,
  count: number,
  detail: string,
  members: Map<string, ClanMember>
): WarnBoardRow {
  const m = members.get(userId);
  return {
    rank,
    username: m?.username || username,
    displayName: m?.displayName || m?.username || username,
    avatarUrl: m?.avatarUrl ?? null,
    robloxAvatarUrl: m?.robloxAvatarUrl ?? null,
    count,
    detail,
  };
}

/** Canvas + back button. Shared by /warnboard and the Command Center button. */
export async function buildWarnBoardPayload(clan: Clan): Promise<BaseMessageOptions> {
  const [warned, reminded, members] = await Promise.all([
    rankByWarnings(clan.guildId, 10),
    rankByReminders(clan.guildId, 10),
    db.select().from(clanMembersTable).where(eq(clanMembersTable.guildId, clan.guildId)),
  ]);
  const byId = memberMap(members);
  const png = await renderOffThread("warnBoardCard", {
    communityName: clan.clanName,
    activityName: activityWord(clan),
    warned: warned.map((r, i) =>
      present(
        i + 1,
        r.userId,
        r.username,
        r.count,
        r.active === r.count ? "all still active" : `${r.active} still active`,
        byId
      )
    ),
    reminded: reminded.map((r, i) =>
      present(i + 1, r.userId, r.username, r.count, "reminders sent", byId)
    ),
  });
  const back = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(DASH_HOME).setStyle(ButtonStyle.Primary).setLabel("Overview")
  );
  return {
    content: "",
    embeds: [],
    files: [new AttachmentBuilder(png, { name: "warn-board.png" })],
    components: [back],
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
  const payload = await buildWarnBoardPayload(clan);
  await interaction.editReply({ ...payload, components: [] });
}
