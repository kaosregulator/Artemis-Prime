import {
  ButtonStyle,
  StringSelectMenuBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Clan, Ticket } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import { listTickets, getTicket, updateTicket } from "../services/tickets";
import { relative } from "../services/time";
import { TICKET_PICK, ticketProgress, ticketResolve, ticketClose, ticketAssign, parseId } from "../ui/ids";
import { notConfiguredMessage } from "./xp";
import { ticketDetailV2, ticketListV2, statePanel } from "../ui/v2/commonPanels";
import { actionRow, v2Button } from "../ui/v2/primitives";

/**
 * Tickets — a staff-only record view. No Discord channels are created; a ticket
 * is a tracked record with an assignee, status and resolution. Staff advance it
 * open → in progress → resolved / closed.
 */

const STATUS_BADGE: Record<string, string> = {
  open: "🟡 Open",
  in_progress: "🔵 In progress",
  resolved: "✅ Resolved",
  closed: "⬛ Closed",
};

async function guard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  deferred: boolean
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    const msg = notConfiguredMessage(isOfficer(interaction.member, null));
    if (deferred) await interaction.editReply(msg);
    else await interaction.reply({ ...msg, flags: 64 });
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    const panel = statePanel({ kind: "denied", body: "Tickets are officer-only." });
    if (deferred) await interaction.editReply(panel as Parameters<typeof interaction.editReply>[0]);
    else await interaction.reply({ ...panel, flags: 64 });
    return null;
  }
  return clan;
}

function ticketLine(t: Ticket): string {
  const who = t.assignedToUsername ? ` · 👤 ${t.assignedToUsername}` : "";
  return `${STATUS_BADGE[t.status] ?? t.status} · **#${t.id}** ${t.username} — ${t.issue.slice(0, 70)}${who} · ${relative(t.createdAt)}`;
}

export async function buildTicketList(clan: Clan): Promise<BaseMessageOptions> {
  const open = await listTickets(clan.guildId, "open", 25);
  const select =
    open.length > 0
      ? new StringSelectMenuBuilder()
          .setCustomId(TICKET_PICK)
          .setPlaceholder("Open a ticket…")
          .addOptions(
            open.slice(0, 25).map((t) => ({
              label: `#${t.id} — ${t.username}`.slice(0, 100),
              description: `${t.status} · ${t.issue}`.slice(0, 100),
              value: String(t.id),
            }))
          )
      : null;

  return ticketListV2({
    clanName: clan.clanName,
    lines: open.map(ticketLine),
    select,
  });
}

export async function openTickets(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await guard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildTicketList(clan));
}

async function ticketDetail(clan: Clan, t: Ticket): Promise<BaseMessageOptions> {
  const rows = [
    actionRow(
      v2Button({ customId: ticketAssign(t.id), label: "Assign to me", style: ButtonStyle.Primary }),
      v2Button({ customId: ticketProgress(t.id), label: "In progress" }),
      v2Button({ customId: ticketResolve(t.id), label: "Resolve", style: ButtonStyle.Success }),
      v2Button({ customId: ticketClose(t.id), label: "Close", style: ButtonStyle.Danger })
    ),
  ];
  return ticketDetailV2({
    id: t.id,
    username: t.username,
    issue: t.issue,
    status: STATUS_BADGE[t.status] ?? t.status,
    assigned: t.assignedToUsername ? `<@${t.assignedTo}>` : "_unassigned_",
    opened: relative(t.createdAt),
    warning: t.relatedWarningId ? `#${t.relatedWarningId}` : null,
    dispute: t.relatedDisputeId ? `#${t.relatedDisputeId}` : null,
    resolution: t.resolution?.slice(0, 1024) ?? null,
    rows,
  });
}

export async function handleTicketSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;
  const id = Number(interaction.values[0]);
  const t = id ? await getTicket(clan.guildId, id) : null;
  if (!t) {
    await interaction.followUp({
      ...statePanel({ kind: "error", body: "That ticket no longer exists." }),
      flags: 64,
    });
    return;
  }
  await interaction.followUp({ ...(await ticketDetail(clan, t)), flags: 64 });
}

export async function handleTicketButton(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });
  const clan = await guard(interaction, true);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  const tid = Number(arg);
  if (!tid) return;
  const staff = { id: interaction.user.id, username: interaction.user.username };

  switch (action) {
    case "assign":
      await updateTicket({
        clan,
        ticketId: tid,
        assignedTo: staff.id,
        assignedToUsername: staff.username,
        status: "in_progress",
        staffId: staff.id,
        staffUsername: staff.username,
      });
      await interaction.editReply(
        statePanel({
          kind: "success",
          body: `Ticket #${tid} assigned to you and marked in progress.`,
        }) as Parameters<typeof interaction.editReply>[0]
      );
      return;
    case "progress":
      await updateTicket({
        clan,
        ticketId: tid,
        status: "in_progress",
        staffId: staff.id,
        staffUsername: staff.username,
      });
      await interaction.editReply(
        statePanel({
          kind: "success",
          body: `Ticket #${tid} marked in progress.`,
        }) as Parameters<typeof interaction.editReply>[0]
      );
      return;
    case "resolve":
      await updateTicket({
        clan,
        ticketId: tid,
        status: "resolved",
        staffId: staff.id,
        staffUsername: staff.username,
      });
      await interaction.editReply(
        statePanel({
          kind: "success",
          body: `Ticket #${tid} resolved.`,
        }) as Parameters<typeof interaction.editReply>[0]
      );
      return;
    case "close":
      await updateTicket({
        clan,
        ticketId: tid,
        status: "closed",
        staffId: staff.id,
        staffUsername: staff.username,
      });
      await interaction.editReply(
        statePanel({
          kind: "success",
          body: `Ticket #${tid} closed.`,
        }) as Parameters<typeof interaction.editReply>[0]
      );
      return;
  }
}
