/**
 * /xpwarn — roll call.
 *
 * 1. Staff pick up to 25 people (and the activity).
 * 2. The bot suggests a reminder or a warning for each (see services/rollCall)
 *    and shows a preview; staff can change anyone.
 * 3. Post → DMs go out as usual, and ONE grouped message lands in the channel
 *    (instead of one image card per person).
 * 4. Undo for 10 minutes.
 *
 * Replaces the 5-step enforcement picker as the /xpwarn entry point. The old
 * picker's handlers stay routed so buttons on old messages keep working.
 */
import {
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  ActionRowBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type InteractionEditReplyOptions,
  type ModalActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { db, remindersTable } from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getClan, isAdmin, isOfficer, getMember } from "../services/config";
import { ensureDefaultCategories, getCategory } from "../services/activity";
import { sendReminder } from "../services/reminders";
import { issueWarning, removeWarning } from "../services/warnings";
import { logAction } from "../services/logging";
import { sanitizeMemberReason } from "../services/tracking";
import {
  ROLL_CALL_MAX,
  buildPlan,
  loadRollFacts,
  rollCallCopy,
  type RollAction,
  type RollEntry,
  type RollFacts,
} from "../services/rollCall";
import {
  parseId,
  rcCancel,
  rcCategory,
  rcEdit,
  rcNote,
  rcNoteModal,
  rcPeople,
  rcPick,
  rcPost,
  rcSetTo,
  rcUndo,
} from "../ui/ids";
import { V2_FLAGS, actionRow, container, separator, textDisplay, v2Button } from "../ui/v2/primitives";
import { notConfiguredMessage } from "./xp";
import { logger } from "../../lib/logger";

const UNDO_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;

interface Posted {
  channelId: string;
  messageId: string;
  warningIds: number[];
  reminderUserIds: string[];
  startedAt: Date;
  at: number;
}

interface Session {
  ownerId: string;
  guildId: string;
  categoryKey: string;
  categoryLabel: string;
  people: Array<{ id: string; name: string; bot: boolean }>;
  facts: RollFacts[];
  overrides: Map<string, RollAction>;
  picked: string[];
  note: string | null;
  posting: boolean;
  posted: Posted | null;
  ts: number;
}

const sessions = new Map<string, Session>();

function newToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function prune() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [k, s] of sessions) if (s.ts < cutoff) sessions.delete(k);
}

type Payload = InteractionEditReplyOptions & { flags: number };

function v2(children: Parameters<typeof container>[0]["children"]): Payload {
  return { flags: V2_FLAGS, components: [container({ children })] } as Payload;
}

function expired(): Payload {
  return v2([textDisplay("This roll call expired. Run `/xpwarn` again.")]);
}

/* ----------------------------------------------------------------- screens */

async function categoryRow(guildId: string, tok: string, selected: string) {
  const cats = (await ensureDefaultCategories(guildId)).slice(0, 25);
  return actionRow(
    new StringSelectMenuBuilder()
      .setCustomId(rcCategory(tok))
      .setPlaceholder("Activity")
      .addOptions(
        cats.map((c) => ({ label: c.name.slice(0, 100), value: c.key, default: c.key === selected }))
      )
  );
}

function peopleRow(tok: string, selected: string[]) {
  return actionRow(
    new UserSelectMenuBuilder()
      .setCustomId(rcPeople(tok))
      .setPlaceholder("Who did you notice?")
      .setMinValues(1)
      .setMaxValues(ROLL_CALL_MAX)
      .setDefaultUsers(selected.slice(0, ROLL_CALL_MAX))
  );
}

async function pickScreen(tok: string, s: Session): Promise<Payload> {
  return v2([
    textDisplay("### Roll call"),
    textDisplay(
      `Pick everyone you noticed, up to ${ROLL_CALL_MAX}. You'll see who gets a reminder or a warning before anything posts.`
    ),
    await categoryRow(s.guildId, tok, s.categoryKey),
    peopleRow(tok, s.people.map((p) => p.id)),
    actionRow(v2Button({ customId: rcCancel(tok), label: "Cancel" })),
  ]);
}

function group(plan: RollEntry[], action: RollAction): RollEntry[] {
  return plan.filter((e) => e.action === action);
}

function lines(entries: RollEntry[]): string {
  return entries
    .map((e) => `<@${e.userId}> · ${e.why}${e.getsRole ? " · **gets the XP warning role**" : ""}`)
    .join("\n");
}

async function previewScreen(tok: string, s: Session, clan: Clan): Promise<Payload> {
  const plan = buildPlan(clan, s.facts, s.overrides);
  const rem = group(plan, "reminder");
  const warn = group(plan, "warning");
  const skip = group(plan, "skip");
  const sendable = rem.length + warn.length;

  const children: Parameters<typeof container>[0]["children"] = [
    textDisplay(`### ${s.categoryLabel} roll call`),
    textDisplay(
      [
        `**${rem.length}** reminder${rem.length === 1 ? "" : "s"}`,
        `**${warn.length}** warning${warn.length === 1 ? "" : "s"}`,
        skip.length ? `**${skip.length}** skipped` : null,
      ]
        .filter(Boolean)
        .join(" · ") + "\n-# A reminder comes before a warning. Change anyone below before posting."
    ),
  ];
  for (const [title, entries] of [
    ["Reminders", rem],
    ["Warnings", warn],
    ["Skipped", skip],
  ] as const) {
    if (!entries.length) continue;
    children.push(separator(), textDisplay(`**${title}**\n${lines(entries)}`));
  }
  if (s.note) children.push(separator(), textDisplay(`**Note to include**\n> ${s.note.replace(/\n/g, "\n> ")}`));

  children.push(separator(true));
  // Change people: pick some, then press what they should get.
  children.push(
    actionRow(
      new StringSelectMenuBuilder()
        .setCustomId(rcPick(tok))
        .setPlaceholder("Change someone…")
        .setMinValues(1)
        .setMaxValues(Math.max(1, Math.min(25, plan.length)))
        .addOptions(
          plan.slice(0, 25).map((e) => ({
            label: e.name.slice(0, 100),
            value: e.userId,
            description: `Now: ${e.action}`,
            default: s.picked.includes(e.userId),
          }))
        )
    )
  );
  const hasPicked = s.picked.length > 0;
  children.push(
    actionRow(
      v2Button({ customId: rcSetTo(tok, "reminder"), label: "Make reminder", disabled: !hasPicked }),
      v2Button({ customId: rcSetTo(tok, "warning"), label: "Make warning", disabled: !hasPicked }),
      v2Button({ customId: rcSetTo(tok, "skip"), label: "Skip", disabled: !hasPicked })
    ),
    actionRow(
      v2Button({
        customId: rcPost(tok),
        label: sendable ? `Post (${sendable})` : "Nothing to post",
        style: ButtonStyle.Success,
        disabled: !sendable,
      }),
      v2Button({ customId: rcNote(tok), label: s.note ? "Edit note" : "Add note" }),
      v2Button({ customId: rcEdit(tok), label: "Change people" }),
      v2Button({ customId: rcCancel(tok), label: "Cancel" })
    )
  );
  return v2(children);
}

/* ------------------------------------------------------------------ guards */

async function officerClan(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isOfficer(interaction.member, clan)) return null;
  return clan;
}

function sessionFor(tok: string | undefined, userId: string): Session | null {
  if (!tok) return null;
  const s = sessions.get(tok);
  if (!s || s.ownerId !== userId) return null;
  s.ts = Date.now();
  return s;
}

/* ---------------------------------------------------------------- handlers */

export async function openRollCall(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply(v2([textDisplay("Roll call is for officers.")]));
    return;
  }
  prune();
  const cats = await ensureDefaultCategories(clan.guildId);
  const cat = cats.find((c) => c.key === "xp") ?? cats[0];
  const tok = newToken();
  const s: Session = {
    ownerId: interaction.user.id,
    guildId: clan.guildId,
    categoryKey: cat?.key ?? "xp",
    categoryLabel: cat?.name ?? clan.activityName ?? "XP",
    people: [],
    facts: [],
    overrides: new Map(),
    picked: [],
    note: null,
    posting: false,
    posted: null,
    ts: Date.now(),
  };
  sessions.set(tok, s);
  await interaction.editReply(await pickScreen(tok, s));
}

async function refreshFacts(interaction: { guild: NonNullable<ButtonInteraction["guild"]> }, s: Session, clan: Clan) {
  s.facts = await loadRollFacts(clan, interaction.guild, s.people, s.categoryKey);
}

export async function handleRollCallUserSelect(interaction: UserSelectMenuInteraction) {
  const { arg } = parseId(interaction.customId);
  const s = sessionFor(arg, interaction.user.id);
  if (!s) return void (await interaction.update(expired()));
  await interaction.deferUpdate();
  const clan = await officerClan(interaction);
  if (!clan || !interaction.inCachedGuild()) return;
  s.people = interaction.users.map((u) => {
    const gm = interaction.members.get(u.id) as GuildMember | undefined;
    return { id: u.id, name: gm?.displayName ?? u.globalName ?? u.username, bot: u.bot };
  });
  // Keep staff changes only for people still on the list.
  for (const id of [...s.overrides.keys()]) if (!s.people.some((p) => p.id === id)) s.overrides.delete(id);
  s.picked = [];
  await refreshFacts(interaction, s, clan);
  await interaction.editReply(await previewScreen(arg!, s, clan));
}

export async function handleRollCallStringSelect(interaction: StringSelectMenuInteraction) {
  const { action, arg } = parseId(interaction.customId);
  const s = sessionFor(arg, interaction.user.id);
  if (!s) return void (await interaction.update(expired()));
  await interaction.deferUpdate();
  const clan = await officerClan(interaction);
  if (!clan || !interaction.inCachedGuild()) return;

  if (action === "cat") {
    const key = interaction.values[0] ?? s.categoryKey;
    const cat = await getCategory(clan.guildId, key);
    s.categoryKey = key;
    s.categoryLabel = cat?.name ?? key;
    s.overrides.clear(); // suggestions depend on the activity
    s.picked = [];
    if (!s.people.length) return void (await interaction.editReply(await pickScreen(arg!, s)));
    await refreshFacts(interaction, s, clan);
    return void (await interaction.editReply(await previewScreen(arg!, s, clan)));
  }
  if (action === "pick") {
    s.picked = [...interaction.values];
    return void (await interaction.editReply(await previewScreen(arg!, s, clan)));
  }
}

export async function handleRollCallButton(interaction: ButtonInteraction) {
  const { action, arg = "" } = parseId(interaction.customId);
  const [tok, to] = action === "to" ? (arg.split("-") as [string, RollAction]) : [arg, undefined];
  const s = sessionFor(tok, interaction.user.id);
  if (!s) {
    if (action === "undo") {
      return void (await interaction.reply({ content: "Only the officer who posted this roll call can undo it.", flags: 64 }));
    }
    return void (await interaction.update(expired()));
  }

  if (action === "note") {
    const modal = new ModalBuilder()
      .setCustomId(rcNoteModal(tok))
      .setTitle("Note for this roll call")
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("note")
            .setLabel("Shown to everyone in the post")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(400)
            .setValue(s.note ?? "")
        )
      );
    return void (await interaction.showModal(modal));
  }

  await interaction.deferUpdate();
  const clan = await officerClan(interaction);
  if (!clan || !interaction.inCachedGuild()) return;

  switch (action) {
    case "cancel":
      sessions.delete(tok);
      return void (await interaction.editReply(v2([textDisplay("Roll call cancelled. Nothing was sent.")])));
    case "edit":
      return void (await interaction.editReply(await pickScreen(tok, s)));
    case "to":
      if (to === "reminder" || to === "warning" || to === "skip") {
        for (const id of s.picked) s.overrides.set(id, to);
        s.picked = [];
      }
      return void (await interaction.editReply(await previewScreen(tok, s, clan)));
    case "post":
      return void (await post(interaction, s, tok, clan));
    case "undo":
      return void (await undo(interaction, s, tok, clan));
  }
}

export async function handleRollCallModal(interaction: ModalSubmitInteraction) {
  const { arg } = parseId(interaction.customId);
  const s = sessionFor(arg, interaction.user.id);
  if (!s || !interaction.isFromMessage()) {
    return void (await interaction.reply({ content: "This roll call expired. Run `/xpwarn` again.", flags: 64 }));
  }
  await interaction.deferUpdate();
  const clan = await officerClan(interaction);
  if (!clan) return;
  const raw = interaction.fields.getTextInputValue("note").trim();
  s.note = raw ? sanitizeMemberReason(raw) || null : null;
  await interaction.editReply(await previewScreen(arg!, s, clan));
}

/* -------------------------------------------------------------- post/undo */

function postChannelId(clan: Clan, hasWarnings: boolean, fallback: string): string {
  return hasWarnings
    ? (clan.warningChannelId ?? clan.reminderChannelId ?? fallback)
    : (clan.reminderChannelId ?? clan.warningChannelId ?? fallback);
}

async function post(interaction: ButtonInteraction<"cached">, s: Session, tok: string, clan: Clan) {
  if (s.posting || s.posted) return;
  s.posting = true;
  const plan = buildPlan(clan, s.facts, s.overrides);
  const copy = rollCallCopy(s.categoryLabel);
  const startedAt = new Date();
  const mod = { id: interaction.user.id, name: interaction.member.displayName ?? interaction.user.username };

  await interaction.editReply(v2([textDisplay(`Posting roll call for ${plan.filter((e) => e.action !== "skip").length} people…`)]));

  const reminded: RollEntry[] = [];
  const warned: Array<RollEntry & { roleOn: boolean }> = [];
  const warningIds: number[] = [];
  const failed: string[] = [];

  for (const e of plan) {
    if (e.action === "skip") continue;
    const user = await interaction.client.users.fetch(e.userId).catch(() => null);
    if (!user || user.bot) {
      failed.push(e.name);
      continue;
    }
    try {
      if (e.action === "reminder") {
        await sendReminder({
          client: interaction.client,
          clan,
          target: user,
          member: await getMember(clan.guildId, e.userId),
          auto: false,
          moderatorId: mod.id,
          moderatorUsername: mod.name,
          note: s.note,
          deliver: { dm: clan.dmReminders, channel: false, noChannelFallback: true },
          categoryKey: s.categoryKey,
          categoryLabel: s.categoryLabel,
        });
        reminded.push(e);
      } else {
        const res = await issueWarning({
          client: interaction.client,
          clan,
          guild: interaction.guild,
          target: user,
          moderatorId: mod.id,
          moderatorUsername: mod.name,
          reason: `Roll call by ${mod.name} · ${s.categoryLabel}${s.note ? ` · ${s.note}` : ""}`,
          memberReason: s.note ?? copy.memberWarningReason,
          categoryKey: s.categoryKey,
          categoryLabel: s.categoryLabel,
          deliver: { dm: clan.dmOnWarn, channel: false },
        });
        warningIds.push(res.warning.id);
        warned.push({ ...e, roleOn: res.roleApplied });
      }
    } catch (err) {
      logger.warn({ err, userId: e.userId }, "Roll call entry failed");
      failed.push(e.name);
    }
  }

  // One grouped message, like the officers' manual post — but logged.
  const parts: Parameters<typeof container>[0]["children"] = [textDisplay(`## ${copy.title}`)];
  if (reminded.length) {
    parts.push(textDisplay(`**Reminder** · ${reminded.map((e) => `<@${e.userId}>`).join(" ")}\n${copy.reminder}`));
  }
  if (warned.length) {
    if (reminded.length) parts.push(separator());
    const roleLines = warned.filter((w) => w.roleOn).map((w) => `<@${w.userId}> ${copy.role}`);
    parts.push(
      textDisplay(
        `**Warning** · ${warned.map((e) => `<@${e.userId}>`).join(" ")}\n${copy.warning}` +
          (roleLines.length ? `\n${roleLines.join("\n")}` : "")
      )
    );
  }
  if (s.note) parts.push(textDisplay(`> ${s.note.replace(/\n/g, "\n> ")}`));
  parts.push(textDisplay(`-# Sent by <@${mod.id}>`));

  const pingUsers = [
    ...(clan.pingReminders ? reminded.map((e) => e.userId) : []),
    ...warned.map((e) => e.userId),
  ];
  const channelId = postChannelId(clan, warned.length > 0, interaction.channelId);
  let posted: { channelId: string; messageId: string } | null = null;
  if (reminded.length || warned.length) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      if (ch?.isTextBased() && "send" in ch) {
        const msg = await ch.send({
          flags: V2_FLAGS,
          components: [container({ children: parts })],
          allowedMentions: { users: pingUsers, roles: [] },
        });
        posted = { channelId, messageId: msg.id };
      }
    } catch (err) {
      logger.warn({ err, channelId }, "Roll call post failed");
    }
  }

  s.posting = false;
  s.posted = {
    channelId: posted?.channelId ?? channelId,
    messageId: posted?.messageId ?? "",
    warningIds,
    reminderUserIds: reminded.map((e) => e.userId),
    startedAt,
    at: Date.now(),
  };

  await logAction(clan.guildId, {
    action: "roll_call_posted",
    moderatorId: mod.id,
    moderatorUsername: mod.name,
    details: {
      category: s.categoryKey,
      reminders: reminded.map((e) => e.userId),
      warnings: warned.map((e) => e.userId),
      skipped: plan.filter((e) => e.action === "skip").map((e) => e.userId),
      failed,
      messageId: posted?.messageId ?? null,
    },
  });

  const summary = [
    `**Posted.** ${reminded.length} reminder${reminded.length === 1 ? "" : "s"} · ${warned.length} warning${warned.length === 1 ? "" : "s"}` +
      (warned.some((w) => w.roleOn) ? ` · ${warned.filter((w) => w.roleOn).length} got the XP warning role` : ""),
    posted
      ? `Message: https://discord.com/channels/${clan.guildId}/${posted.channelId}/${posted.messageId}`
      : `Couldn't post in <#${channelId}>. Check the bot can send messages there. DMs and records went through.`,
    failed.length ? `Couldn't reach: ${failed.join(", ")}` : null,
    "-# Undo works for 10 minutes. It removes the post, the warnings and the reminders. DMs already sent can't be unsent.",
  ]
    .filter(Boolean)
    .join("\n");
  await interaction.editReply(
    v2([textDisplay(summary), actionRow(v2Button({ customId: rcUndo(tok), label: "Undo", style: ButtonStyle.Danger }))])
  );
}

async function undo(interaction: ButtonInteraction<"cached">, s: Session, tok: string, clan: Clan) {
  const p = s.posted;
  if (!p) return;
  if (Date.now() - p.at > UNDO_MS && !isAdmin(interaction.member, clan)) {
    return void (await interaction.editReply(
      v2([textDisplay("Undo has expired (10 minutes). Clear warnings one by one from `/warnboard`.")])
    ));
  }
  for (const id of p.warningIds) {
    await removeWarning({
      guild: interaction.guild,
      clan,
      warningId: id,
      moderatorId: interaction.user.id,
      moderatorUsername: interaction.user.username,
    }).catch((err) => logger.warn({ err, id }, "Roll call undo: warning removal failed"));
  }
  if (p.reminderUserIds.length) {
    await db
      .delete(remindersTable)
      .where(
        and(
          eq(remindersTable.guildId, clan.guildId),
          eq(remindersTable.sentBy, s.ownerId),
          eq(remindersTable.categoryKey, s.categoryKey),
          inArray(remindersTable.userId, p.reminderUserIds),
          gte(remindersTable.createdAt, p.startedAt)
        )
      );
  }
  if (p.messageId) {
    const ch = await interaction.client.channels.fetch(p.channelId).catch(() => null);
    if (ch?.isTextBased()) await ch.messages.delete(p.messageId).catch(() => undefined);
  }
  await logAction(clan.guildId, {
    action: "roll_call_undone",
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
    details: { warnings: p.warningIds, reminders: p.reminderUserIds, messageId: p.messageId || null },
  });
  sessions.delete(tok);
  await interaction.editReply(
    v2([textDisplay("**Undone.** The post, warnings and reminders were removed. DMs that already went out stay in members' inboxes.")])
  );
}

/** Test-only hooks. */
export const __rollCallForTest = { previewScreen, sessions };
