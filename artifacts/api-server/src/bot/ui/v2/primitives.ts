/**
 * Reusable Discord Components V2 layout helpers.
 *
 * V2 messages must set MessageFlags.IsComponentsV2 and must NOT mix
 * content / embeds / poll / stickers. Keep business logic out of this module.
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
}): MessageEditOptions & { flags: number } {
  return {
    flags: V2_FLAGS,
    components: opts.components,
    ...(opts.files ? { files: opts.files } : {}),
    ...(opts.clearAttachments ? { attachments: [] } : {}),
  };
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
