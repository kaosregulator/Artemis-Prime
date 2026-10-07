/**
 * Staff attach an in-game clan logo. The image is re-posted into the log
 * channel (or the channel the command was run in) so Discord keeps hosting it,
 * then saved on the clan and painted onto warning and reminder cards.
 */
import {
  AttachmentBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer, updateClan } from "../services/config";
import { logger } from "../../lib/logger";

const MAX_BYTES = 8 * 1024 * 1024;

export function isLogoImage(attachment: Attachment): boolean {
  const ct = (attachment.contentType ?? "").toLowerCase();
  return ct.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(attachment.name ?? "");
}

function safeFileName(name: string | null): string {
  const cleaned = (name || "clan-logo.png").replace(/[^\w.\-]+/g, "_").slice(0, 80);
  return /\.(png|jpe?g|gif|webp)$/i.test(cleaned) ? cleaned : `${cleaned || "clan-logo"}.png`;
}

export async function storeClanLogo(
  client: Client,
  clan: Clan,
  attachment: Attachment,
  fallbackChannelId: string
): Promise<{ ok: true; clan: Clan; note: string } | { ok: false; error: string }> {
  if (!isLogoImage(attachment)) {
    return {
      ok: false,
      error:
        "The clan logo has to be an image (PNG, JPG, GIF, or WebP) attached with the command — not a link.",
    };
  }
  if (attachment.size > MAX_BYTES) {
    return { ok: false, error: "That image is over 8 MB. Use a smaller clan logo." };
  }

  let bytes: Buffer;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(String(res.status));
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn({ err }, "Clan logo download failed");
    return { ok: false, error: "Couldn't read that image. Attach it again." };
  }

  const channelId = clan.logChannelId || fallbackChannelId;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      return { ok: false, error: "Couldn't find a channel to keep the clan logo." };
    }
    const msg = await channel.send({
      content:
        `🖼️ Clan logo for **${clan.clanName}**. It appears on warning and reminder cards. ` +
        `Leave this message up — deleting it removes the image.`,
      files: [new AttachmentBuilder(bytes, { name: safeFileName(attachment.name) })],
    });
    const hosted = msg.attachments.first()?.url ?? attachment.url;
    const updated = await updateClan(clan.guildId, { clanLogoUrl: hosted });
    if (!updated) return { ok: false, error: "Couldn't save the clan logo." };
    const where = clan.logChannelId ? `<#${clan.logChannelId}>` : "this channel";
    return {
      ok: true,
      clan: updated,
      note:
        `Clan logo saved. Warning and reminder cards use it as a soft background and a header mark, ` +
        `and the Roblox avatar sits below it. Hosted in ${where}.`,
    };
  } catch (err) {
    logger.warn({ err }, "Clan logo host post failed");
    const updated = await updateClan(clan.guildId, { clanLogoUrl: attachment.url });
    if (!updated) return { ok: false, error: "Couldn't save the clan logo." };
    return {
      ok: true,
      clan: updated,
      note: "Clan logo saved. If it stops showing on cards, run `/clanlogo` again.",
    };
  }
}

export async function handleClanLogo(interaction: ChatInputCommandInteraction) {
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
    await interaction.editReply({ content: "Only officers can set the clan logo." });
    return;
  }
  const image = interaction.options.getAttachment("image", true);
  const saved = await storeClanLogo(interaction.client, clan, image, interaction.channelId);
  await interaction.editReply({ content: saved.ok ? saved.note : saved.error });
}
