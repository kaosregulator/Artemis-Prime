/**
 * Keeps ticket records honest when their Discord channel disappears.
 *
 * Leveling orders and disputes each own a private channel. If staff delete
 * that channel by hand (instead of the bot's Delete button), the DB row used
 * to stay "active": the order kept its queue slot as a ghost, and the
 * customer was blocked forever by "You already have an open order".
 *
 * Three entry points share one code path:
 *  - live: Discord's ChannelDelete event (Guilds intent, no extra perms);
 *  - startup sweep: catches deletes that happened while the bot was offline;
 *  - lazy self-heal: the "already open" guards verify the channel still exists.
 *
 * Nothing is deleted from the database. Orders are cancelled through the
 * normal action path (customer notified, queue renumbered, staff log), and
 * disputes are closed without a decision so the warning is left untouched.
 */
import type { Client, Guild } from "discord.js";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  disputesTable,
  serviceOrdersTable,
  SERVICE_ORDER_QUEUE_STATUSES,
  type Dispute,
  type ServiceOrder,
} from "@workspace/db";
import { getClan } from "./config";
import { applyServiceOrderAction } from "./serviceOrders";
import { OPEN_DISPUTE_STATUSES } from "./disputes";
import { logAction } from "./logging";
import { logger } from "../../lib/logger";

const SYSTEM_ACTOR = { id: "system", username: "Artemis (auto-cleanup)" } as const;
const ORDER_NOTE = "Ticket channel was deleted — order closed so the queue can move on.";
const DISPUTE_RESULT = "Closed · ticket channel was deleted (no decision made)";

/** Close the active order bound to a channel that no longer exists. */
async function closeOrphanOrder(client: Client, guild: Guild, order: ServiceOrder): Promise<void> {
  const clan = await getClan(order.guildId);
  if (!clan) return;
  // Drop the dead channel reference first so the cancel path never tries to
  // post into (or fetch) a channel that is gone.
  await db
    .update(serviceOrdersTable)
    .set({ channelId: null, ticketMessageId: null })
    .where(eq(serviceOrdersTable.id, order.id));
  const res = await applyServiceOrderAction({
    client,
    guild,
    clan,
    orderId: order.id,
    action: "cancel",
    actorId: SYSTEM_ACTOR.id,
    actorUsername: SYSTEM_ACTOR.username,
    note: ORDER_NOTE,
  });
  if (!res.ok) logger.warn({ orderId: order.id, error: res.error }, "Orphan order cancel failed");
  else logger.info({ orderId: order.id, publicId: order.publicId }, "Closed order whose ticket channel was deleted");
}

async function closeOrphanDispute(dispute: Dispute): Promise<void> {
  await db
    .update(disputesTable)
    .set({ status: "closed", channelId: null, result: DISPUTE_RESULT })
    .where(and(eq(disputesTable.guildId, dispute.guildId), eq(disputesTable.id, dispute.id)));
  await logAction(dispute.guildId, {
    action: "dispute_channel_missing",
    targetUserId: dispute.userId,
    targetUsername: dispute.username,
    moderatorId: SYSTEM_ACTOR.id,
    moderatorUsername: SYSTEM_ACTOR.username,
    details: { disputeId: dispute.id, previousChannelId: dispute.channelId, result: DISPUTE_RESULT },
  }).catch(() => undefined);
  logger.info({ disputeId: dispute.id }, "Closed dispute whose ticket channel was deleted");
}

/** ChannelDelete handler: reconcile whatever ticket owned this channel. */
export async function onTicketChannelDeleted(
  client: Client,
  guild: Guild,
  channelId: string
): Promise<void> {
  const orders = await db
    .select()
    .from(serviceOrdersTable)
    .where(
      and(
        eq(serviceOrdersTable.guildId, guild.id),
        eq(serviceOrdersTable.channelId, channelId),
        inArray(serviceOrdersTable.status, [...SERVICE_ORDER_QUEUE_STATUSES])
      )
    );
  for (const o of orders) await closeOrphanOrder(client, guild, o);

  // Terminal orders just lose the stale reference (keeps "see #channel" links honest).
  await db
    .update(serviceOrdersTable)
    .set({ channelId: null, ticketMessageId: null })
    .where(and(eq(serviceOrdersTable.guildId, guild.id), eq(serviceOrdersTable.channelId, channelId)));

  const disputes = await db
    .select()
    .from(disputesTable)
    .where(and(eq(disputesTable.guildId, guild.id), eq(disputesTable.channelId, channelId)));
  for (const d of disputes) {
    if (OPEN_DISPUTE_STATUSES.includes(d.status as (typeof OPEN_DISPUTE_STATUSES)[number])) {
      await closeOrphanDispute(d);
    } else {
      await db.update(disputesTable).set({ channelId: null }).where(eq(disputesTable.id, d.id));
    }
  }
}

/**
 * True when Discord confirms the channel is gone (404 / Unknown Channel).
 * Any other failure (rate limit, outage, missing access) returns false so a
 * flaky API call can never cancel a real, live order.
 */
export async function ticketChannelGone(guild: Guild, channelId: string): Promise<boolean> {
  if (guild.channels.cache.has(channelId)) return false;
  try {
    await guild.channels.fetch(channelId, { force: true });
    return false;
  } catch (err) {
    const code = (err as { code?: number; status?: number }).code;
    const status = (err as { status?: number }).status;
    return code === 10003 || status === 404;
  }
}

/** Lazy self-heal used by the "you already have an open order" guard. */
export async function healOrderIfOrphaned(client: Client, guild: Guild, order: ServiceOrder): Promise<boolean> {
  if (!order.channelId) return false;
  if (!(await ticketChannelGone(guild, order.channelId))) return false;
  await closeOrphanOrder(client, guild, order);
  return true;
}

/** Lazy self-heal used by the "you already have an open dispute" guard. */
export async function healDisputeIfOrphaned(guild: Guild, dispute: Dispute): Promise<boolean> {
  if (!dispute.channelId) return false;
  if (!(await ticketChannelGone(guild, dispute.channelId))) return false;
  await closeOrphanDispute(dispute);
  return true;
}

/** Startup sweep: reconcile tickets whose channels vanished while offline. */
export async function reconcileOrphanTickets(client: Client): Promise<{ orders: number; disputes: number }> {
  let orders = 0;
  let disputes = 0;
  for (const guild of client.guilds.cache.values()) {
    const activeOrders = await db
      .select()
      .from(serviceOrdersTable)
      .where(
        and(
          eq(serviceOrdersTable.guildId, guild.id),
          isNotNull(serviceOrdersTable.channelId),
          inArray(serviceOrdersTable.status, [...SERVICE_ORDER_QUEUE_STATUSES])
        )
      );
    for (const o of activeOrders) {
      if (await healOrderIfOrphaned(client, guild, o).catch(() => false)) orders++;
    }
    const openDisputes = await db
      .select()
      .from(disputesTable)
      .where(
        and(
          eq(disputesTable.guildId, guild.id),
          isNotNull(disputesTable.channelId),
          inArray(disputesTable.status, OPEN_DISPUTE_STATUSES)
        )
      );
    for (const d of openDisputes) {
      if (await healDisputeIfOrphaned(guild, d).catch(() => false)) disputes++;
    }
  }
  if (orders || disputes) logger.info({ orders, disputes }, "Reconciled orphaned tickets");
  return { orders, disputes };
}
