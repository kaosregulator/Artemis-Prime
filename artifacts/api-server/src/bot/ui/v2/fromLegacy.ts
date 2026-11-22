/**
 * Convert a classic (content + embeds + action rows) payload into a single
 * Components V2 container.
 *
 * Why this exists: Discord refuses to remove the IsComponentsV2 flag from a
 * message once it is set. Any V2 panel that navigates to a sub-screen still
 * built from embeds (e.g. every /setup section) fails with 50035, and the
 * router's fallback `editReply({ content })` fails the same way — the user just
 * sees "This interaction failed". Converting at the edit boundary lets legacy
 * screens keep working inside V2 messages without rewriting each one.
 *
 * Limits honoured (Discord V2): ≤ 4000 text chars across the whole message,
 * ≤ 40 components in total (nested ones included), ≤ 5 buttons per row.
 */
import {
  ActionRowBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  type APIEmbed,
  type BaseMessageOptions,
  type JSONEncodable,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import {
  V2_ACCENT,
  V2_FLAGS,
  container,
  separator,
  section,
  textDisplay,
  type V2Accent,
  type V2Child,
} from "./primitives";

const MAX_TEXT = 3900; // leave headroom under Discord's 4000-char total
const MAX_COMPONENTS = 40;

type LegacyPayload = BaseMessageOptions & { flags?: unknown; content?: string | null };

function flagBits(flags: unknown): number {
  if (typeof flags === "number") return flags;
  if (typeof flags === "bigint") return Number(flags);
  if (flags && typeof flags === "object" && "bitfield" in flags) {
    return Number((flags as { bitfield: number | bigint }).bitfield);
  }
  return 0;
}

export function isV2Payload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return (flagBits((payload as { flags?: unknown }).flags) & V2_FLAGS) === V2_FLAGS;
}

/** True when the payload carries fields Discord forbids on a V2 message. */
export function hasLegacyFields(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as LegacyPayload;
  const hasContent = typeof p.content === "string" && p.content.trim().length > 0;
  const hasEmbeds = Array.isArray(p.embeds) && p.embeds.length > 0;
  return hasContent || hasEmbeds;
}

function toApiEmbed(e: APIEmbed | JSONEncodable<APIEmbed>): APIEmbed {
  if (e instanceof EmbedBuilder) return e.toJSON();
  if (e && typeof (e as JSONEncodable<APIEmbed>).toJSON === "function") {
    return (e as JSONEncodable<APIEmbed>).toJSON();
  }
  return e as APIEmbed;
}

/** Map an arbitrary embed colour onto the restrained V2 accent set. */
function accentFor(color: number | undefined): V2Accent {
  if (color == null) return V2_ACCENT.info;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  if (r > 180 && g < 110 && b < 110) return V2_ACCENT.danger;
  if (r > 200 && g > 120 && b < 90) return V2_ACCENT.warning;
  if (g > 140 && r < 120 && b < 140) return V2_ACCENT.success;
  if (r < 110 && g < 110 && b < 110) return V2_ACCENT.muted;
  return V2_ACCENT.info;
}

class Budget {
  text = MAX_TEXT;
  components = MAX_COMPONENTS - 1; // the container itself
  take(s: string): string | null {
    if (this.text <= 0 || this.components <= 0) return null;
    const out = s.length > this.text ? `${s.slice(0, Math.max(0, this.text - 1))}…` : s;
    this.text -= out.length;
    this.components -= 1;
    return out;
  }
}

function embedChildren(e: APIEmbed, budget: Budget): V2Child[] {
  const out: V2Child[] = [];
  const head: string[] = [];
  if (e.author?.name) head.push(`-# ${e.author.name}`);
  if (e.title) head.push(`### ${e.title}`);
  if (e.description) head.push(e.description);
  const headText = head.join("\n");
  if (headText) {
    const t = budget.take(headText);
    if (t) {
      const thumb = e.thumbnail?.url;
      if (thumb && budget.components >= 2) {
        budget.components -= 1; // section wrapper + thumbnail accessory
        out.push(section({ text: t, thumbnailUrl: thumb }));
      } else {
        out.push(textDisplay(t));
      }
    }
  }

  // Fields: inline runs collapse into one compact block; others stand alone.
  const fields = e.fields ?? [];
  if (fields.length) {
    const blocks: string[] = [];
    let inline: string[] = [];
    const flush = () => {
      if (inline.length) blocks.push(inline.join("\n"));
      inline = [];
    };
    for (const f of fields) {
      const line = `**${f.name}**\n${f.value}`;
      if (f.inline) inline.push(line);
      else {
        flush();
        blocks.push(line);
      }
    }
    flush();
    if (out.length && budget.components > 2) {
      budget.components -= 1;
      out.push(separator());
    }
    for (const b of blocks) {
      const t = budget.take(b);
      if (t) out.push(textDisplay(t));
    }
  }

  const img = e.image?.url;
  if (img && budget.components >= 2) {
    budget.components -= 2;
    // MediaGallery accepts attachment:// and https URLs alike.
    out.push(mediaFor(img));
  }

  const foot = [e.footer?.text, e.timestamp ? `<t:${Math.floor(new Date(e.timestamp).getTime() / 1000)}:R>` : null]
    .filter(Boolean)
    .join(" · ");
  if (foot) {
    const t = budget.take(`-# ${foot}`);
    if (t) out.push(textDisplay(t));
  }
  return out;
}

function mediaFor(url: string): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url));
}

/**
 * Convert a legacy payload to V2. Already-V2 payloads and payloads without
 * content/embeds are returned unchanged.
 */
export function legacyToV2<T extends object>(payload: T): T {
  if (isV2Payload(payload) || !hasLegacyFields(payload)) return payload;
  const p = payload as LegacyPayload;
  const budget = new Budget();
  const embeds = (p.embeds ?? []).map(toApiEmbed);
  const children: V2Child[] = [];

  if (typeof p.content === "string" && p.content.trim()) {
    const t = budget.take(p.content);
    if (t) children.push(textDisplay(t));
  }
  embeds.forEach((e, i) => {
    if ((i > 0 || children.length) && budget.components > 2) {
      budget.components -= 1;
      children.push(separator());
    }
    children.push(...embedChildren(e, budget));
  });

  // Action rows ride inside the container so the panel reads as one surface.
  for (const row of (p.components ?? []) as Array<ActionRowBuilder<MessageActionRowComponentBuilder>>) {
    const size =
      row instanceof ActionRowBuilder
        ? 1 + row.components.length
        : 1 + (((row as { components?: unknown[] }).components ?? []).length);
    if (budget.components < size) break;
    budget.components -= size;
    children.push(
      row instanceof ActionRowBuilder
        ? row
        : (ActionRowBuilder.from(row as never) as ActionRowBuilder<MessageActionRowComponentBuilder>)
    );
  }

  if (!children.length) children.push(textDisplay("​"));

  const {
    content: _c,
    embeds: _e,
    components: _k,
    flags: _f,
    ...rest
  } = p as LegacyPayload & Record<string, unknown>;
  // Ephemeral bit (64) on the original flags must survive the conversion.
  const keepEphemeral = flagBits(p.flags) & 64;
  return {
    ...rest,
    flags: V2_FLAGS | keepEphemeral,
    components: [container({ accent: accentFor(embeds[0]?.color), children })],
  } as unknown as T;
}
