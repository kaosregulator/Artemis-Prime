import {
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { getClan, isOfficer } from "../services/config";
import { removeWarning } from "../services/warnings";
import { helpPanelV2, statePanel } from "../ui/v2/commonPanels";

/**
 * /help and the warning-removal select handler. The `/warnings` command itself
 * now lives in features/userHub.ts (member record vs. officer dashboard); the
 * remove-warning dropdown it renders is still handled here under NS.warn.
 */

/** /help — how the officer-managed workflow works (Components V2). */
export async function handleHelp(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This command only works inside a server.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  const activity = clan?.activityName || "activity";
  const game = clan?.gameName || "your game";
  const officer = isOfficer(interaction.member, clan ?? null);

  await interaction.editReply(
    helpPanelV2({
      clanName: clan?.clanName ?? "Clan",
      activityName: activity,
      gameName: game,
      officer,
    }) as Parameters<typeof interaction.editReply>[0]
  );
}

/** Handle removal selection from /warnings. */
export async function handleWarnRemoveSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan || !isOfficer(interaction.member, clan)) {
    await interaction.editReply(
      statePanel({ kind: "denied", body: "Only officers can remove warnings." }) as Parameters<
        typeof interaction.editReply
      >[0]
    );
    return;
  }
  const warningId = Number(interaction.values[0]);
  const removed = await removeWarning({
    guild: interaction.guild,
    clan,
    warningId,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
  });
  await interaction.editReply(
    statePanel({
      kind: removed ? "success" : "warning",
      body: removed ? `Removed warning #${warningId}.` : "That warning was already removed.",
    }) as Parameters<typeof interaction.editReply>[0]
  );
}
