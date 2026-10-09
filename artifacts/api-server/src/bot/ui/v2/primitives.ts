/**
 * Reusable Discord Components V2 layout helpers.
 *
 * V2 messages must set MessageFlags.IsComponentsV2 and must NOT mix
 * content / embeds / poll / stickers. Keep business logic out of this module.
 *
 * Important: discord.js MessagePayload.makeContent() coerces `content: null` →
 * `""`. Sending that empty string with IsComponentsV2 trips Discord error
 * 50035 (MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2). When converting
 * a legacy message to V2, clear content/embeds in a separate edit first — see
 * editMessageAsV2().
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type ButtonComponentData,
  type Message,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";

/** Restrained accent accents — avoid loud multi-color panels. */
export const V2_ACCENT = {
  brand: 0x3f51e0,
  success: 0x3ba55d,
  warning: 0xfaa81a,
  danger: 0xed4245,
  muted: 0x4e5058,
  info: 0x5865f2,
} as const;

export type V2Accent = (typeof V2_ACCENT)[keyof typeof V2_ACCENT];

export const V2_FLAGS = MessageFlags.IsComponentsV2;

export function textDisplay(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content.slice(0, 4000));
}

export function separator(large = false): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

export type V2Child =
  | TextDisplayBuilder
  | SectionBuilder
  | SeparatorBuilder
  | FileBuilder
  | MediaGalleryBuilder
  | ActionRowBuilder<MessageActionRowComponentBuilder>;

export function container(opts: {
  accent?: V2Accent;
  children: V2Child[];
}): ContainerBuilder {
  const c = new ContainerBuilder();
  if (opts.accent != null) c.setAccentColor(opts.accent);
  for (const child of opts.children) {
    if (child instanceof TextDisplayBuilder) c.addTextDisplayComponents(child);
    else if (child instanceof SectionBuilder) c.addSectionComponents(child);
    else if (child instanceof SeparatorBuilder) c.addSeparatorComponents(child);
    else if (child instanceof FileBuilder) c.addFileComponents(child);
    else if (child instanceof MediaGalleryBuilder) c.addMediaGalleryComponents(child);
    else c.addActionRowComponents(child);
  }
  return c;
}

/** Reference an uploaded attachment inside a V2 container. */
export function attachmentFile(filename: string): FileBuilder {
  return new FileBuilder().setURL(`attachment://${filename}`);
}

export function attachmentGallery(filename: string, description?: string): MediaGalleryBuilder {
  const item = new MediaGalleryItemBuilder().setURL(`attachment://${filename}`);
  if (description) item.setDescription(description.slice(0, 1024));
  return new MediaGalleryBuilder().addItems(item);
}

export function section(opts: {
  text: string | string[];
  button?: ButtonBuilder;
  thumbnailUrl?: string | null;
}): SectionBuilder {
  const lines = Array.isArray(opts.text) ? opts.text : [opts.text];
  const s = new SectionBuilder().addTextDisplayComponents(
    ...lines.filter(Boolean).map((line) => textDisplay(line))
  );
  if (opts.button) s.setButtonAccessory(opts.button);
  else if (opts.thumbnailUrl) {
    s.setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.thumbnailUrl));
  }
  return s;
}

export function v2Button(opts: {
  customId: string;
  label: string;
  style?: ButtonStyle;
  emoji?: string;
  disabled?: boolean;
}): ButtonBuilder {
  const b = new ButtonBuilder()
    .setCustomId(opts.customId)
    .setLabel(opts.label.slice(0, 80))
    .setStyle(opts.style ?? ButtonStyle.Secondary);
  if (opts.emoji) b.setEmoji(opts.emoji);
  if (opts.disabled) b.setDisabled(true);
  return b;
}

export function actionRow(
  ...components: MessageActionRowComponentBuilder[]
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

export type V2StateKind = "loading" | "empty" | "success" | "warning" | "error" | "denied";

const STATE_TITLE: Record<V2StateKind, string> = {
  loading: "Working…",
  empty: "Nothing here",
  success: "Done",
  warning: "Heads up",
  error: "Something went wrong",
  denied: "Permission denied",
};

const STATE_ACCENT: Record<V2StateKind, V2Accent> = {
  loading: V2_ACCENT.muted,
  empty: V2_ACCENT.muted,
  success: V2_ACCENT.success,
  warning: V2_ACCENT.warning,
  error: V2_ACCENT.danger,
  denied: V2_ACCENT.danger,
};

/** Compact status panel for ephemeral feedback. */
export function statePanel(opts: {
  kind: V2StateKind;
  title?: string;
  body: string;
  extra?: Array<TextDisplayBuilder | SeparatorBuilder | ActionRowBuilder<MessageActionRowComponentBuilder>>;
}): MessageCreateOptions {
  return v2Message({
    components: [
      container({
        accent: STATE_ACCENT[opts.kind],
        children: [
          textDisplay(`### ${opts.title ?? STATE_TITLE[opts.kind]}`),
          textDisplay(opts.body),
          ...(opts.extra ?? []),
        ],
      }),
    ],
  });
}

/**
 * Build a Components V2 message payload.
 * Callers must not also set content/embeds.
 */
export function v2Message(opts: {
  components: ContainerBuilder[];
  files?: MessageCreateOptions["files"];
}): MessageCreateOptions & { flags: number } {
  return {
    flags: V2_FLAGS,
    components: opts.components,
    ...(opts.files ? { files: opts.files } : {}),
  };
}

export function v2Edit(opts: {
  components: ContainerBuilder[];
  files?: MessageEditOptions["files"];
  /** When true, clear previous attachments before applying new files. */
  clearAttachments?: boolean;
  /** Keep existing attachments by id (no re-upload). */
  attachments?: MessageEditOptions["attachments"];
}): MessageEditOptions & { flags: number } {
  const payload: MessageEditOptions & { flags: number } = {
    flags: V2_FLAGS,
    components: opts.components,
    ...(opts.files ? { files: opts.files } : {}),
    ...(opts.clearAttachments
      ? { attachments: [] }
      : opts.attachments
        ? { attachments: opts.attachments }
        : {}),
  };
  return stripLegacyMessageFields(payload);
}

/** Drop top-level content/embeds/poll/stickers so they never ride along with V2. */
export function stripLegacyMessageFields<T extends object>(payload: T): T {
  const {
    content: _content,
    embeds: _embeds,
    poll: _poll,
    stickers: _stickers,
    sticker_ids: _stickerIds,
    ...rest
  } = payload as T & {
    content?: unknown;
    embeds?: unknown;
    poll?: unknown;
    stickers?: unknown;
    sticker_ids?: unknown;
  };
  return rest as T;
}

function messageNeedsLegacyClear(message: Message): boolean {
  if (message.flags.has(MessageFlags.IsComponentsV2)) return false;
  return (
    Boolean(message.content) ||
    message.embeds.length > 0 ||
    message.stickers.size > 0
  );
}

/**
 * Edit a channel message into (or within) Components V2 safely.
 *
 * Converting legacy embed/content messages requires a clear pass first —
 * Discord demands content/embeds reset when setting IsComponentsV2, but
 * discord.js cannot send `content: null` in the same payload as that flag.
 */
export async function editMessageAsV2(
  message: Message,
  opts: MessageEditOptions
): Promise<Message> {
  const safe = stripLegacyMessageFields({ ...opts, flags: V2_FLAGS });
  const replacingFiles = Array.isArray(safe.files) && safe.files.length > 0;

  if (messageNeedsLegacyClear(message)) {
    const keepAttachments =
      safe.attachments ??
      (replacingFiles
        ? []
        : [...message.attachments.values()].map((file) => ({ id: file.id })));
    await message.edit({
      content: null,
      embeds: [],
      components: [],
      attachments: keepAttachments,
    });
  }

  return message.edit(safe as MessageEditOptions);
}

/** Format helpers shared across V2 surfaces. */
export function fmtId(id: string | number): string {
  return `\`${id}\``;
}

export function fmtStatus(emoji: string, label: string): string {
  return `${emoji} **${label}**`.trim();
}

export function fmtUser(userId: string): string {
  return `<@${userId}>`;
}

export function fmtChannel(channelId: string): string {
  return `<#${channelId}>`;
}

export function fmtRole(roleId: string): string {
  return `<@&${roleId}>`;
}

export type { ButtonComponentData };
