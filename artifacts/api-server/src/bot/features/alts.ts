/**
 * /alts — Patriots & Guardians alt submit + leaderboard.
 */
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { getClan, isAdmin, isOfficer } from "../services/config";
import {
  upsertAltDaily,
  postAltBoard,
  refreshAltBoardNow,
  buildAltLeaderboardPayload,
  clampAltCount,
} from "../services/altBoard";
import { NS, parseId, ALT_SUBMIT, ALT_SUBMIT_MODAL, ALT_LEADERBOARD_REFRESH } from "../ui/ids";
import { notConfiguredMessage } from "./xp";

export async function handleAltsCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "Guild only.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "panel") {
    if (!isAdmin(interaction.member, clan)) {
      await interaction.editReply({ content: "Only admins can post the alt board." });
      return;
    }
    const channel =
      interaction.options.getChannel("channel") ?? interaction.channel;
    if (!channel || !("id" in channel)) {
      await interaction.editReply({ content: "Pick a text channel." });
      return;
    }
    const res = await postAltBoard(clan, channel.id);
    if (!res.ok) {
      await interaction.editReply({ content: `⚠️ ${res.reason}` });
      return;
    }
    await interaction.editReply({
      content: `✅ Alt submit panel + leaderboard posted in <#${channel.id}>.`,
    });
    return;
  }

  if (sub === "leaderboard") {
    const mode =
      (interaction.options.getString("mode") as "today" | "alltime" | null) ?? "alltime";
    const payload = await buildAltLeaderboardPayload(interaction.client, clan, mode);
    await interaction.editReply({
      embeds: payload.embeds,
      files: payload.files,
      components: payload.components,
    });
    return;
  }

  if (sub === "today") {
    const payload = await buildAltLeaderboardPayload(interaction.client, clan, "today");
    await interaction.editReply({
      embeds: payload.embeds,
      files: payload.files,
      components: payload.components,
    });
    return;
  }

  if (sub === "set") {
    if (!isOfficer(interaction.member, clan)) {
      await interaction.editReply({ content: "Only officers can edit alt counts." });
      return;
    }
    const user = interaction.options.getUser("user", true);
    const count = interaction.options.getInteger("count", true);
    const dateOpt = interaction.options.getString("date");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const res = await upsertAltDaily({
      clan,
      userId: user.id,
      username: user.username,
      displayName: member?.displayName ?? user.displayName,
      altCount: count,
      activityDate: dateOpt ?? undefined,
      recordedBy: interaction.user.id,
      recordedByUsername: interaction.user.username,
      note: "staff edit",
    });
    if (!res.ok) {
      await interaction.editReply({ content: `⚠️ ${res.error}` });
      return;
    }
    await interaction.editReply({
      content:
        `✅ Set **${res.row.displayName}** to **${res.row.altCount}** alts on **${res.date}**.` +
        `\nLeaderboard refreshing…`,
    });
    return;
  }

  await interaction.editReply({ content: "Unknown subcommand." });
}

export async function handleAltButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { ns, action } = parseId(interaction.customId);
  if (ns !== NS.alt) return;

  if (action === "submit" || interaction.customId === ALT_SUBMIT) {
    const modal = new ModalBuilder()
      .setCustomId(ALT_SUBMIT_MODAL)
      .setTitle("Submit today's alts");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("count")
          .setLabel("How many alts today? (1–100)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(3)
          .setPlaceholder("e.g. 12")
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "lbRefresh" || interaction.customId === ALT_LEADERBOARD_REFRESH) {
    await interaction.deferUpdate();
    const clan = await getClan(interaction.guildId);
    if (!clan) return;
    // Toggle based on current embed title if present
    const title = interaction.message.embeds[0]?.title ?? "";
    const next = /today/i.test(title) ? "alltime" : "today";
    await refreshAltBoardNow(clan.guildId, next);
    // Also reply ephemeral snapshot if this wasn't the durable dash message
    if (!interaction.message.components.length) return;
    return;
  }
}

export async function handleAltModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (parseId(interaction.customId).ns !== NS.alt) return;
  if (interaction.customId !== ALT_SUBMIT_MODAL && parseId(interaction.customId).action !== "submitModal") {
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const raw = interaction.fields.getTextInputValue("count").trim();
  const n = Number(raw);
  if (clampAltCount(n) == null) {
    await interaction.editReply({ content: "Enter a whole number from **1** to **100**." });
    return;
  }

  const res = await upsertAltDaily({
    clan,
    userId: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.member?.displayName ?? interaction.user.displayName,
    altCount: n,
    recordedBy: interaction.user.id,
    recordedByUsername: interaction.user.username,
  });
  if (!res.ok) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }

  await interaction.editReply({
    content:
      `✅ Logged **${res.row.altCount}** alt(s) for **${res.date}**.\n` +
      `You're on the Patriot / Guardian board.`,
  });
}
