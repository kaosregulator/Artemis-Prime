/**
 * Components V2 setup hub (main panel pilot).
 * Sub-panels remain classic embeds until migrated individually.
 * Button custom IDs are unchanged.
 */
import { ButtonStyle, type MessageCreateOptions } from "discord.js";
import type { Clan } from "@workspace/db";
import { weekRangeLabel, weekKey } from "../../services/time";
import { getTrackingPeriod, periodAdjective, periodLabel } from "../../services/tracking";
import { disputeStaffRoleIds } from "../../services/disputes";
import {
  SETUP_GOAL,
  SETUP_MODE,
  SETUP_PERIOD,
  SETUP_SCHEDULE,
  SETUP_CHANNELS,
  SETUP_ROLES,
  SETUP_NOTIFY,
  SETUP_WHITELIST,
  SETUP_CARDS,
  SETUP_DISPUTES,
  SETUP_LEVELING,
  SETUP_FINISH,
  wizGo,
} from "../ids";
import {
  V2_ACCENT,
  actionRow,
  container,
  separator,
  textDisplay,
  v2Button,
  v2Message,
} from "./primitives";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function check(v: unknown): string {
  return v ? "✅" : "⬜";
}

function serviceTeamRoleIds(clan: Clan): string[] {
  if (clan.serviceOrderTeamRoleId) return [clan.serviceOrderTeamRoleId];
  return disputeStaffRoleIds(clan);
}

function modeLabel(clan: Clan): string {
  if (clan.trackingMode === "complete") return "Complete / Not complete";
  if (clan.trackingMode === "custom") return "Custom goal";
  return "Exact progress";
}

function periodSetupLabel(clan: Clan): string {
  return clan.trackingPeriod === "daily" ? "Daily" : "Weekly";
}

function cardStyleLabel(clan: Clan): string {
  return clan.cardStyle === "embed" ? "Avatar embed" : "Canvas cards";
}

function warnRemovalLabel(hours: number): string {
  if (!hours || hours <= 0) return "off";
  if (hours === 1) return "Hourly";
  if (hours === 24) return "Daily";
  if (hours === 168) return "Weekly";
  if (hours === 720) return "Monthly (30 days)";
  if (hours % 720 === 0) return `every ${hours / 720} month(s)`;
  if (hours % 168 === 0) return `every ${hours / 168} week(s)`;
  if (hours % 24 === 0) return `every ${hours / 24} day(s)`;
  return `every ${hours} hour(s)`;
}

function goalLine(clan: Clan): string {
  const period = periodAdjective(clan);
  if (clan.trackingMode === "complete") {
    return `Complete the ${period} **${clan.activityName}** requirement`;
  }
  if (getTrackingPeriod(clan) === "daily") {
    const goal = clan.dailyTarget > 0 ? clan.dailyTarget : clan.weeklyGoal;
    return `**${goal.toLocaleString()} ${clan.activityName}** per day`;
  }
  return `**${clan.weeklyGoal.toLocaleString()} ${clan.activityName}** per week`;
}

/** Main configuration hub — Components V2. */
export function setupMainPayloadV2(clan: Clan): MessageCreateOptions {
  const period = periodLabel(clan);
  const weekBit =
    getTrackingPeriod(clan) === "weekly"
      ? ` · Current week: **${weekRangeLabel(weekKey(clan))}**`
      : "";

  const requirement = [
    `${check(clan.weeklyGoal || clan.trackingMode === "complete")} **${period} requirement**`,
    `${goalLine(clan)}`,
    `Tracking mode: **${modeLabel(clan)}** · Period: **${periodSetupLabel(clan)}**`,
  ].join("\n");

  const schedule = [
    `${check(true)} **Schedule**`,
    getTrackingPeriod(clan) === "weekly"
      ? `Week starts **${DAY_NAMES[clan.weekStartDay] ?? "Monday"}** at **${clan.resetTime}** (${clan.timezone})`
      : `Resets every day at **${clan.resetTime}** (${clan.timezone})`,
    `Auto reset: **${clan.autoWeeklyReset ? "on" : "off"}** · Archive history: **${clan.archiveWeeks ? "on" : "off"}**`,
    `Reminders: **${clan.remindersEnabled ? "on" : "OFF"}**` +
      (clan.remindersEnabled
        ? ` — ${clan.reminderDays.map((d: number) => DAY_NAMES[d]?.slice(0, 3)).filter(Boolean).join(", ") || "no days"} at ${clan.reminderTimes[0] ?? "not set"}`
        : ""),
  ].join("\n");

  const enforcement = [
    `${check(clan.warningThreshold)} **Enforcement**`,
    `Warning after **${clan.warningThreshold}** reminder(s) without hitting the goal`,
    `Leadership review at **${clan.escalationThreshold}** active warning(s)`,
    `Warning role auto-removal: **${warnRemovalLabel(clan.warningRemovalHours)}**`,
    `Warning/reminder style: **${cardStyleLabel(clan)}**`,
  ].join("\n");

  const channels = [
    `${check(clan.reminderChannelId || clan.logChannelId)} **Channels**`,
    `Reminders: ${clan.reminderChannelId ? `<#${clan.reminderChannelId}>` : "_DM only_"}`,
    `Warnings: ${clan.warningChannelId ? `<#${clan.warningChannelId}>` : "_not set_"}`,
    `Logs: ${clan.logChannelId ? `<#${clan.logChannelId}>` : "_not set_"}`,
  ].join("\n");

  const disputes = [
    `${check(clan.disputeCategoryId)} **Activity disputes**`,
    `Category: ${clan.disputeCategoryId ? `<#${clan.disputeCategoryId}>` : "_not set — /dispute disabled_"}`,
    `Staff role: ${
      clan.disputeStaffRoleId
        ? `<@&${clan.disputeStaffRoleId}>`
        : disputeStaffRoleIds(clan).map((r: string) => `<@&${r}>`).join(" ") || "_officers / admins_"
    }`,
  ].join("\n");

  const leveling = [
    `${check(clan.serviceOrdersEnabled && clan.serviceOrderChannelId && clan.serviceOrderCategoryId)} **Leveling service**`,
    `Enabled: ${clan.serviceOrdersEnabled ? "yes" : "no"}`,
    `Orders board: ${clan.serviceOrderChannelId ? `<#${clan.serviceOrderChannelId}>` : "_not set_"}`,
    `Ticket category: ${clan.serviceOrderCategoryId ? `<#${clan.serviceOrderCategoryId}>` : "_not set_"}`,
    `Team role: ${
      clan.serviceOrderTeamRoleId
        ? `<@&${clan.serviceOrderTeamRoleId}>`
        : serviceTeamRoleIds(clan).map((r: string) => `<@&${r}>`).join(" ") || "_officers / admins_"
    }`,
  ].join("\n");

  const roles = [
    `${check(clan.staffRoleIds.length || clan.adminRoleIds.length || clan.requiredRoleId)} **Roles**`,
    `Activity track: ${clan.requiredRoleId ? `<@&${clan.requiredRoleId}>` : "_not set — all linked members_"}`,
    `Officers: ${clan.staffRoleIds.map((r: string) => `<@&${r}>`).join(" ") || "_server managers only_"}`,
    `Admins: ${clan.adminRoleIds.map((r: string) => `<@&${r}>`).join(" ") || "_server managers only_"}`,
    `Whitelisted users: ${clan.adminUserIds.map((u: string) => `<@${u}>`).join(" ") || "_none_"}`,
  ].join("\n");

  return v2Message({
    components: [
      container({
        accent: clan.setupComplete ? V2_ACCENT.success : V2_ACCENT.info,
        children: [
          textDisplay(`# Configuration — ${clan.clanName}`),
          textDisplay(
            `Officers log **activity** in **${clan.gameName}** and update the bot. Members never submit anything.\n` +
              `Tracking period: **${period}**${weekBit}`
          ),
          separator(),
          textDisplay(requirement),
          separator(),
          textDisplay(schedule),
          separator(),
          textDisplay(enforcement),
          separator(),
          textDisplay(channels),
          separator(),
          textDisplay(disputes),
          separator(),
          textDisplay(leveling),
          separator(),
          textDisplay(roles),
          separator(true),
          textDisplay(
            clan.setupComplete
              ? "_Everything is live — tweak any section anytime._"
              : "_Set a requirement, tracking period and officer roles, then press Finish._"
          ),
          actionRow(
            v2Button({ customId: SETUP_GOAL, label: "Requirement", style: ButtonStyle.Primary }),
            v2Button({ customId: SETUP_PERIOD, label: "Daily / Weekly", style: ButtonStyle.Primary }),
            v2Button({ customId: SETUP_MODE, label: "Tracking Mode", style: ButtonStyle.Primary })
          ),
          actionRow(
            v2Button({ customId: SETUP_SCHEDULE, label: "Schedule & Enforcement", style: ButtonStyle.Primary }),
            v2Button({ customId: SETUP_CHANNELS, label: "Channels" }),
            v2Button({ customId: SETUP_ROLES, label: "Roles" })
          ),
          actionRow(
            v2Button({ customId: SETUP_NOTIFY, label: "Notifications" }),
            v2Button({ customId: SETUP_WHITELIST, label: "Whitelist" }),
            v2Button({ customId: SETUP_CARDS, label: "Warnings & Cards" })
          ),
          actionRow(
            v2Button({ customId: SETUP_DISPUTES, label: "XP Disputes", style: ButtonStyle.Primary }),
            v2Button({ customId: SETUP_LEVELING, label: "Leveling Service", style: ButtonStyle.Primary }),
            v2Button({ customId: SETUP_FINISH, label: "Finish", style: ButtonStyle.Success }),
            v2Button({ customId: wizGo(1), label: "Guided setup wizard", emoji: "🧭" })
          ),
        ],
      }),
    ],
  });
}
