import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { getClan, isOfficer } from "../services/config";
import { removeWarning } from "../services/warnings";

/**
 * /help and the warning-removal select handler. The `/warnings` command itself
 * now lives in features/userHub.ts (member record vs. officer dashboard); the
 * remove-warning dropdown it renders is still handled here under NS.warn.
 */

/** /help — how the officer-managed workflow works. */
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

  const embed = new EmbedBuilder()
    .setColor(0x3f51e0)
    .setTitle(`${clan?.clanName ?? "Clan"} — how this works`)
    .setDescription(
      [
        "This is a community desk for your clan. It is not an in-game score tracker.",
        "",
        `**${activity}** is just the name of the thing people do in ${game}. Officers send a reminder or a warning when someone missed it. The bot does not score that game number.`,
        "",
        "**Clan points** are awards staff give for side stuff a member does. They are separate from warnings.",
        "",
        "Only people with the **clan role** you set are included. Channels, that role, and the warning card are yours to configure in **/setup** — nothing is locked to one server.",
      ].join("\n")
    )
    .addFields({
      name: "Members",
      value: [
        "`/warnings` — your own warnings",
        "`/dispute` — contest a warning",
        "`/leaderboard` — clan points and clean record",
        "`/roblox` `/scout` `/market` — Roblox tools",
      ].join("\n"),
    });

  if (officer) {
    embed.addFields(
      {
        name: "Messages",
        value: [
          "`/xpwarn` — remind or warn the people you pick",
          "`/warnboard` — who has the most, 10 per page",
          "`/warnings` — staff desk, then **Most warned & reminded**",
          "`/clanlogo` — image on those warning and reminder cards",
        ].join("\n"),
      },
      {
        name: "Linking",
        value:
          "`/link` walks the clan role. It shows the Discord nickname and username. If the server uses Bloxlink, that nick is already the Roblox name, so matching is faster. Other people in the server are not included.",
      },
      {
        name: "Setup",
        value: "`/setup` — activity name, clan role, channels, warning card. `/panel` posts the live staff desk.",
      }
    );
  }

  await interaction.editReply({ embeds: [embed] });
}

/** Handle removal selection from /warnings. */
export async function handleWarnRemoveSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan || !isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can remove warnings." });
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
  await interaction.editReply({
    content: removed ? `✅ Removed warning #${warningId}.` : "That warning was already removed.",
  });
}
