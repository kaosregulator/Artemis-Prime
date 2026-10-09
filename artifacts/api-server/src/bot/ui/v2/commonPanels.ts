/**
 * Shared Components V2 panels for help, tickets, disputes, warnings.
 */
import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
} from "discord.js";
import {
  V2_ACCENT,
  actionRow,
  container,
  separator,
  statePanel,
  textDisplay,
  v2Button,
  v2Message,
  fmtUser,
  type V2Accent,
} from "./primitives";

export function simpleV2Panel(opts: {
  title: string;
  body: string;
  accent?: V2Accent;
  rows?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}): MessageCreateOptions {
  return v2Message({
    components: [
      container({
        accent: opts.accent ?? V2_ACCENT.info,
        children: [
          textDisplay(`# ${opts.title}`),
          separator(),
          textDisplay(opts.body),
          ...(opts.rows ?? []),
        ],
      }),
    ],
  });
}

export function helpPanelV2(opts: {
  clanName: string;
  activityName: string;
  gameName: string;
  officer: boolean;
}): MessageCreateOptions {
  const sections = opts.officer
    ? [
        ["### Members", "Check yourself with **/warnings**. Challenge a wrong warning with **/dispute**."],
        ["### Messages", "**/xpwarn** sends reminders or warnings. **/warnboard** ranks who has the most."],
        ["### Awards", "**/leaderboard** is clan points — separate from warnings."],
        ["### Setup", "**/setup** configures roles, channels, and cards. **/link** reads the Bloxlink nick."],
        ["### Tools", "**/roblox**, **/scout**, **/market**, **/leveling**."],
      ]
    : [
        ["### Your record", "Open **/warnings** to see standing. Dispute a wrong warning with **/dispute**."],
        ["### Messages", "A reminder is a nudge. A warning means activity was missed."],
        ["### Awards", "**/leaderboard** shows clan points."],
        ["### Tools", "**/roblox**, **/scout**, and **/market**."],
      ];

  const children = [
    textDisplay(`# Help — ${opts.clanName}`),
    textDisplay(`Tracking **${opts.activityName}** in **${opts.gameName}**.`),
    separator(),
  ];
  for (const [title, body] of sections) {
    children.push(textDisplay(title), textDisplay(body), separator());
  }

  return v2Message({
    components: [
      container({
        accent: V2_ACCENT.brand,
        children,
      }),
    ],
  });
}

export function ticketListV2(opts: {
  clanName: string;
  lines: string[];
  select?: StringSelectMenuBuilder | null;
}): MessageCreateOptions {
  const empty = !opts.lines.length;
  return v2Message({
    components: [
      container({
        accent: empty ? V2_ACCENT.success : V2_ACCENT.warning,
        children: [
          textDisplay(`# Tickets — ${opts.clanName}`),
          textDisplay(
            empty
              ? "No open tickets."
              : `**${opts.lines.length} open**\n${opts.lines.join("\n")}`.slice(0, 3900)
          ),
          separator(),
          textDisplay(
            "**1 Assign** — pick a ticket\n**2 In progress** — mark when you start\n**3 Finish** — resolve or close"
          ),
          ...(opts.select ? [actionRow(opts.select)] : []),
        ],
      }),
    ],
  });
}

export function ticketDetailV2(opts: {
  id: number;
  username: string;
  issue: string;
  status: string;
  assigned: string;
  opened: string;
  warning?: string | null;
  dispute?: string | null;
  resolution?: string | null;
  rows: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}): MessageCreateOptions {
  const fields = [
    `**Status** ${opts.status}`,
    `**Assigned** ${opts.assigned}`,
    `**Opened** ${opts.opened}`,
    opts.warning ? `**Warning** ${opts.warning}` : null,
    opts.dispute ? `**Dispute** ${opts.dispute}` : null,
    opts.resolution ? `**Resolution** ${opts.resolution}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return v2Message({
    components: [
      container({
        accent: V2_ACCENT.info,
        children: [
          textDisplay(`# Ticket #${opts.id} — ${opts.username}`),
          textDisplay(opts.issue.slice(0, 3500)),
          separator(),
          textDisplay(fields),
          ...opts.rows,
        ],
      }),
    ],
  });
}

export function disputeHowToV2(): MessageCreateOptions {
  return simpleV2Panel({
    title: "How to dispute",
    accent: V2_ACCENT.info,
    body: [
      "Staff answer in a private channel. Resolving a dispute does **not** remove the warning by itself.",
      "",
      "**1** Open **/dispute**",
      "**2** Pick type + explain",
      "**3** Attach evidence from your device",
      "**4** Wait for staff in the private ticket",
    ].join("\n"),
  });
}

export function disputeReviewListV2(opts: {
  clanName: string;
  openLines: string[];
  select?: StringSelectMenuBuilder | null;
}): MessageCreateOptions {
  const empty = !opts.openLines.length;
  return v2Message({
    components: [
      container({
        accent: empty ? V2_ACCENT.success : V2_ACCENT.warning,
        children: [
          textDisplay(`# Disputes — ${opts.clanName}`),
          textDisplay(
            empty
              ? "No open disputes."
              : `**${opts.openLines.length} open**\n${opts.openLines.join("\n")}`.slice(0, 3900)
          ),
          ...(opts.select ? [separator(), actionRow(opts.select)] : []),
        ],
      }),
    ],
  });
}

export function disputeTicketV2(opts: {
  clanName: string;
  disputeId: number;
  memberId: string;
  typeLabel: string;
  status: string;
  reason: string;
  warningLine?: string | null;
  rows: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}): MessageCreateOptions {
  return v2Message({
    components: [
      container({
        accent: V2_ACCENT.info,
        children: [
          textDisplay(`# XP Dispute #${opts.disputeId}`),
          textDisplay(
            [
              `**Member** ${fmtUser(opts.memberId)}`,
              `**Type** ${opts.typeLabel}`,
              `**Status** ${opts.status}`,
            ].join("\n")
          ),
          separator(),
          textDisplay(`**Reason**\n${opts.reason.slice(0, 1800) || "_none_"}`),
          ...(opts.warningLine
            ? [separator(), textDisplay(`**Linked warning**\n${opts.warningLine}`)]
            : []),
          separator(),
          textDisplay(`_${opts.clanName}_`),
          ...opts.rows,
        ],
      }),
    ],
  });
}

export function warningNoticeV2(opts: {
  title: string;
  body: string;
  footer?: string | null;
}): MessageCreateOptions {
  return v2Message({
    components: [
      container({
        accent: V2_ACCENT.danger,
        children: [
          textDisplay(`# ${opts.title}`),
          textDisplay(opts.body),
          ...(opts.footer ? [separator(), textDisplay(`_${opts.footer}_`)] : []),
        ],
      }),
    ],
  });
}

export { statePanel, v2Button, ButtonStyle, actionRow };
