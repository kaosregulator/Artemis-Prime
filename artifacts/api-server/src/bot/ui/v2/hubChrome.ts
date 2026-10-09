/**
 * Uniform Components V2 chrome for canvas-first hubs (Scout, Roblox, Link, Help).
 * Keeps existing ActionRow custom IDs; wraps the PNG in a Media Gallery.
 */
import {
  AttachmentBuilder,
  type AttachmentPayload,
  type BaseMessageOptions,
  type InteractionEditReplyOptions,
  type MessageActionRowComponentBuilder,
  type ActionRowBuilder,
  type MessageCreateOptions,
} from "discord.js";
import {
  V2_ACCENT,
  V2_FLAGS,
  attachmentGallery,
  container,
  separator,
  textDisplay,
  type V2Accent,
  type V2Child,
} from "./primitives";

type RowLike = ActionRowBuilder<MessageActionRowComponentBuilder>;

function fileNameFromPayload(files: BaseMessageOptions["files"]): string | null {
  if (!files || !Array.isArray(files) || !files.length) return null;
  const first = files[0] as
    | AttachmentBuilder
    | AttachmentPayload
    | { name?: string; attachment?: { name?: string } };
  if (first instanceof AttachmentBuilder) {
    return first.name || "card.png";
  }
  if (first && typeof first === "object") {
    if ("name" in first && typeof first.name === "string") return first.name;
    if ("attachment" in first && first.attachment && typeof first.attachment === "object") {
      const n = (first.attachment as { name?: string }).name;
      if (n) return n;
    }
  }
  return "card.png";
}

/**
 * Wrap a classic canvas hub payload (files + action rows) as Components V2.
 * No-ops if the payload is already V2 or has embeds/content only.
 */
export function asCanvasHubV2(
  payload: BaseMessageOptions & { flags?: number },
  opts?: { title?: string; subtitle?: string; accent?: V2Accent }
): MessageCreateOptions {
  const flags = payload.flags;
  if (flags != null && (flags & V2_FLAGS) === V2_FLAGS) {
    return payload as MessageCreateOptions;
  }

  const name = fileNameFromPayload(payload.files);
  if (!name || !payload.files) {
    if (payload.content && !payload.embeds?.length) {
      return {
        flags: V2_FLAGS,
        components: [
          container({
            accent: opts?.accent ?? V2_ACCENT.muted,
            children: [
              ...(opts?.title ? [textDisplay(`### ${opts.title}`)] : []),
              textDisplay(String(payload.content)),
              ...((payload.components ?? []) as RowLike[]),
            ],
          }),
        ],
      };
    }
    return payload as MessageCreateOptions;
  }

  const subtitle = opts?.subtitle ?? (typeof payload.content === "string" ? payload.content : null);
  const children: V2Child[] = [];
  if (opts?.title) children.push(textDisplay(`### ${opts.title}`));
  if (subtitle) children.push(textDisplay(subtitle));
  if (opts?.title || subtitle) children.push(separator());
  children.push(attachmentGallery(name));
  for (const row of (payload.components ?? []) as RowLike[]) {
    children.push(row);
  }

  return {
    flags: V2_FLAGS,
    components: [
      container({
        accent: opts?.accent ?? V2_ACCENT.brand,
        children,
      }),
    ],
    files: payload.files,
  };
}

/** Edit helper — clears stacked attachments and applies V2 hub chrome. */
export function replaceHubCardV2(
  payload: BaseMessageOptions & { flags?: number },
  opts?: { title?: string; subtitle?: string; accent?: V2Accent }
): InteractionEditReplyOptions {
  const v2 = asCanvasHubV2(payload, opts);
  return {
    ...v2,
    content: undefined,
    embeds: [],
    attachments: [],
  } as InteractionEditReplyOptions;
}
