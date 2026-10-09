/**
 * Components V2 panels for service orders (place panel + ticket/board chrome).
 * Preserves existing custom IDs from ../ids — handlers stay unchanged.
 */
import {
  AttachmentBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import type { Clan, ServiceOrder, ServiceOrderStatus } from "@workspace/db";
import {
  STATUS_EMOJI,
  STATUS_LABEL,
  queueHeadline,
  ordersAhead,
  isTerminalStatus,
  SERVICE_ORDER_PATIENCE_NOTICE,
  STAFF_QUICK_REPLIES,
  CUSTOMER_QUICK_REPLIES,
} from "../../services/serviceOrderHelpers";
import { getServiceCatalog } from "../../services/serviceCatalog";
import {
  SVC_PLACE,
  svcClaim,
  svcStart,
  svcHold,
  svcComplete,
  svcReject,
  svcCancel,
  svcQueue,
  svcUp,
  svcDown,
  svcSyncFiles,
  svcQuickReply,
  svcCustomerCancel,
  svcRequestDelete,
  svcCustomerQuickReply,
  svcDelete,
  svcTranscript,
  svcViewPics,
} from "../ids";
import {
  V2_ACCENT,
  actionRow,
  attachmentGallery,
  container,
  separator,
  textDisplay,
  v2Button,
  v2Edit,
  v2Message,
  fmtUser,
  type V2Accent,
} from "./primitives";
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";

function statusAccent(status: ServiceOrderStatus): V2Accent {
  switch (status) {
    case "completed":
      return V2_ACCENT.success;
    case "rejected":
    case "cancelled":
      return V2_ACCENT.danger;
    case "on_hold":
      return V2_ACCENT.warning;
    case "in_progress":
    case "claimed":
      return V2_ACCENT.info;
    default:
      return V2_ACCENT.brand;
  }
}

function staffRows(orderId: number): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    actionRow(
      v2Button({ customId: svcClaim(orderId), label: "Claim", emoji: "✅", style: ButtonStyle.Success }),
      v2Button({ customId: svcStart(orderId), label: "Start", emoji: "▶️", style: ButtonStyle.Primary }),
      v2Button({ customId: svcHold(orderId), label: "Hold", emoji: "⏸️" }),
      v2Button({ customId: svcComplete(orderId), label: "Complete", emoji: "🏁", style: ButtonStyle.Success })
    ),
    actionRow(
      v2Button({ customId: svcUp(orderId), label: "Move Up", emoji: "⬆️" }),
      v2Button({ customId: svcDown(orderId), label: "Move Down", emoji: "⬇️" }),
      v2Button({ customId: svcQueue(orderId), label: "To Queue", emoji: "🔄" }),
      v2Button({ customId: svcSyncFiles(orderId), label: "Sync Files", emoji: "📎" })
    ),
    actionRow(
      v2Button({ customId: svcReject(orderId), label: "Reject", emoji: "❌", style: ButtonStyle.Danger }),
      v2Button({ customId: svcCancel(orderId), label: "Cancel", emoji: "🚫", style: ButtonStyle.Danger }),
      v2Button({ customId: svcTranscript(orderId), label: "Transcript", emoji: "📜" }),
      v2Button({ customId: svcDelete(orderId), label: "Delete Order", emoji: "🗑️", style: ButtonStyle.Danger })
    ),
    actionRow(
      new StringSelectMenuBuilder()
        .setCustomId(svcQuickReply(orderId))
        .setPlaceholder("Staff quick reply…")
        .addOptions(
          STAFF_QUICK_REPLIES.map((r) => ({
            label: r.label.slice(0, 100),
            value: r.key,
            description: r.message.slice(0, 100),
          }))
        )
    ),
  ];
}

function staffTerminalRows(orderId: number): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    actionRow(
      v2Button({ customId: svcTranscript(orderId), label: "Transcript", emoji: "📜" }),
      v2Button({
        customId: svcDelete(orderId),
        label: "Delete Order",
        emoji: "🗑️",
        style: ButtonStyle.Danger,
      })
    ),
  ];
}

function ticketCustomerRows(orderId: number): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    actionRow(
      new StringSelectMenuBuilder()
        .setCustomId(svcCustomerQuickReply(orderId))
        .setPlaceholder("💬 Quick message to staff…")
        .addOptions(
          CUSTOMER_QUICK_REPLIES.map((r) => ({
            label: r.label.slice(0, 100),
            value: r.key,
            description: r.message.slice(0, 100),
          }))
        )
    ),
    actionRow(
      v2Button({
        customId: svcViewPics(orderId),
        label: "View Pics",
        emoji: "📷",
        style: ButtonStyle.Primary,
      }),
      v2Button({ customId: svcRequestDelete(orderId), label: "Request Close", emoji: "🗑️" }),
      v2Button({
        customId: svcCustomerCancel(orderId),
        label: "Cancel Order",
        emoji: "🚫",
        style: ButtonStyle.Danger,
      })
    ),
  ];
}

function rowsForAudience(
  orderId: number,
  audience: "ticket" | "board",
  status: string
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  if (audience === "board") {
    return isTerminalStatus(status) ? staffTerminalRows(orderId) : staffRows(orderId);
  }
  if (isTerminalStatus(status)) return [];
  return ticketCustomerRows(orderId);
}

/** Public “Place Service Order” panel — Components V2. */
export function serviceOrderPanelV2(clan?: Clan | null): MessageCreateOptions {
  const catalog = getServiceCatalog(clan ?? null);
  const serviceLines = catalog.services
    .slice(0, 6)
    .map((s) => `${s.emoji} **${s.label}** — ${s.blurb}`)
    .join("\n");

  return v2Message({
    components: [
      container({
        accent: V2_ACCENT.brand,
        children: [
          textDisplay(`# ${catalog.brandName}`),
          ...(catalog.tagline ? [textDisplay(`*${catalog.tagline}*`)] : []),
          separator(),
          textDisplay(
            [
              "Need something leveled or traded? Open a ticket in a few taps:",
              "",
              "1. Press **Place Service Order**",
              "2. Pick **service** + **priority**",
              `3. Enter your **${catalog.itemNoun}**, levels, and **1–5 photos**`,
              "4. Get a private ticket with queue status and quote",
            ].join("\n")
          ),
          separator(),
          textDisplay(`**What we offer**\n${serviceLines}`),
          separator(true),
          textDisplay(SERVICE_ORDER_PATIENCE_NOTICE),
          actionRow(
            v2Button({
              customId: SVC_PLACE,
              label: "Place Service Order",
              emoji: "🎫",
              style: ButtonStyle.Primary,
            })
          ),
        ],
      }),
    ],
  });
}

export interface OrderPanelInput {
  order: ServiceOrder;
  audience: "ticket" | "board";
  placeMessage?: string | null;
  speedLabel?: string | null;
  quoteLine?: string | null;
  vehicleText?: string | null;
  itemNoun?: string;
  /** Optional canvas PNG — attached when photos/visual card still useful. */
  canvasPng?: Buffer | null;
  /** Reuse an already-uploaded attachment name (no re-upload). */
  existingAttachmentName?: string | null;
  /** Mention line for ticket audience (customer ping). */
  mentionContent?: string | null;
}

/** Build a V2 ticket/board order panel. */
export function buildServiceOrderV2Panel(input: OrderPanelInput): MessageCreateOptions {
  const { order, audience } = input;
  const status = order.status as ServiceOrderStatus;
  const emoji = STATUS_EMOJI[status] ?? "🛠️";
  const label = STATUS_LABEL[status] ?? status;
  const queue =
    order.queuePosition != null
      ? `#${order.queuePosition} (${ordersAhead(order.queuePosition)} ahead)`
      : "—";

  const headline =
    audience === "ticket"
      ? [
          input.mentionContent ?? null,
          input.placeMessage ?? null,
          input.speedLabel ? `⚡ ${input.speedLabel}` : null,
          input.quoteLine ? `💎 ${input.quoteLine}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : queueHeadline(order);

  const detailLines =
    audience === "board"
      ? [
          `**Customer** ${fmtUser(order.customerId)}`,
          `**Queue** ${queue}`,
          `**Staff** ${order.staffId ? fmtUser(order.staffId) : "_unclaimed_"}`,
          input.quoteLine ? `**Quote** ${input.quoteLine}` : null,
          input.speedLabel ? `**Priority** ${input.speedLabel}` : null,
          input.vehicleText
            ? `**${(input.itemNoun ?? "Item").replace(/^./, (c) => c.toUpperCase())}** ${input.vehicleText.slice(0, 200)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      : null;

  const fileName = `order-${order.publicId}.png`;
  const files =
    input.canvasPng && input.canvasPng.length
      ? [new AttachmentBuilder(input.canvasPng, { name: fileName })]
      : undefined;
  const galleryName = files ? fileName : input.existingAttachmentName || null;

  const children = [
    textDisplay(
      audience === "ticket"
        ? `### ${emoji} ${order.publicId}`
        : `### ${emoji} ${order.publicId} · ${order.serviceLabel}`
    ),
    textDisplay(`${emoji} **${label}**`),
    ...(headline ? [textDisplay(headline)] : []),
    ...(detailLines ? [separator(), textDisplay(detailLines)] : []),
    ...(order.attachmentCount > 0
      ? [textDisplay(`📷 **${order.attachmentCount}** photo${order.attachmentCount === 1 ? "" : "s"} on file`)]
      : []),
    ...(galleryName
      ? [separator(), attachmentGallery(galleryName, `${order.publicId} order card`)]
      : []),
    ...rowsForAudience(order.id, audience, status),
  ];

  return v2Message({
    components: [
      container({
        accent: statusAccent(status),
        children,
      }),
    ],
    files,
  });
}

/** Edit payload helper — clears legacy embeds by switching to V2 flags. */
export function buildServiceOrderV2Edit(
  input: OrderPanelInput & { keepExistingAttachments?: { id: string }[] }
): MessageEditOptions {
  const base = buildServiceOrderV2Panel(input);
  return v2Edit({
    components: base.components as never,
    files: base.files,
    clearAttachments: !input.keepExistingAttachments && Boolean(base.files),
  });
}
