import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import type { Clan } from "@workspace/db";
import { legacyToV2, isV2Payload } from "./fromLegacy.js";
import { setupMainPayloadV2 } from "./setupPanels.js";
import { wizardStepPayload } from "../../features/setupWizard.js";
import { __setupSectionsForTest } from "../../features/setup.js";

/** Walk a serialized V2 tree and collect what Discord validates. */
function stats(payload: { components?: unknown[] }) {
  const json = JSON.parse(JSON.stringify(payload.components ?? []));
  let count = 0;
  let text = 0;
  const ids: string[] = [];
  const walk = (n: Record<string, unknown>) => {
    count++;
    if (typeof n.content === "string") text += n.content.length;
    if (typeof n.custom_id === "string") ids.push(n.custom_id);
    for (const k of ["components", "accessory"]) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c));
      else if (v && typeof v === "object") walk(v as Record<string, unknown>);
    }
  };
  json.forEach((n: Record<string, unknown>) => walk(n));
  return { count, text, ids };
}

function assertDiscordValidV2(name: string, payload: object) {
  const p = payload as { flags?: number; content?: unknown; embeds?: unknown; components?: unknown[] };
  assert.ok(isV2Payload(p), `${name}: missing IsComponentsV2`);
  assert.equal(p.content, undefined, `${name}: legacy content`);
  assert.equal(p.embeds, undefined, `${name}: legacy embeds`);
  const s = stats(p);
  assert.ok(s.count <= 40, `${name}: ${s.count} components > 40`);
  assert.ok(s.text <= 4000, `${name}: ${s.text} text chars > 4000`);
  assert.equal(new Set(s.ids).size, s.ids.length, `${name}: duplicate custom_id`);
}

const clan = {
  clanName: "Darknight", gameName: "Roblox", activityName: "XP", setupComplete: true,
  weeklyGoal: 5000, trackingMode: "exact", trackingPeriod: "weekly", weekStartDay: 1,
  resetTime: "00:00", timezone: "UTC", autoWeeklyReset: true, archiveWeeks: true,
  remindersEnabled: true, reminderDays: [1, 3, 5], reminderTimes: ["18:00"],
  warningThreshold: 2, escalationThreshold: 3, warningRemovalHours: 0, cardStyle: "canvas",
  reminderChannelId: "11", warningChannelId: "12", logChannelId: "13",
  disputeCategoryId: "14", disputeStaffRoleId: "15", serviceOrdersEnabled: true,
  serviceOrderChannelId: "16", serviceOrderCategoryId: "17", serviceOrderTeamRoleId: "18",
  serviceOrderWhitelistUserIds: [], serviceOrderWhitelistRoleIds: [],
  serviceOrderBlacklistUserIds: [], serviceOrderBlacklistRoleIds: [],
  staffRoleIds: ["19"], adminRoleIds: ["20"], adminUserIds: ["21"], exemptRoleIds: [],
  leaveRoleIds: [], warnRoleIds: [], warningRoleIds: ["23"], dmOnWarn: true, dmReminders: true,
  pingReminders: false, dailyTarget: 1, gameUrl: "https://roblox.com", serviceOrderReviewChannelId: null,
  serviceOrderDmCustomer: true, serviceOrderDmQueue: true, requiredRoleId: "22", guildId: "1",
  notifyDmWarnings: true, notifyDmReminders: true,
} as unknown as Clan;

describe("legacy → Components V2 conversion", () => {
  it("leaves V2 payloads untouched", () => {
    const v2 = setupMainPayloadV2(clan);
    assert.equal(legacyToV2(v2), v2);
  });

  it("keeps the ephemeral bit and drops legacy fields", () => {
    const out = legacyToV2({
      content: "hello",
      flags: 64,
      embeds: [new EmbedBuilder().setTitle("T").setDescription("D").setColor(0xed4245)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("x:y").setLabel("Go").setStyle(ButtonStyle.Primary)
        ),
      ],
    }) as { flags: number };
    assert.equal(out.flags & 64, 64);
    assert.equal(out.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
    assertDiscordValidV2("sample", out);
    assert.match(JSON.stringify(out), /x:y/);
  });

  it("truncates oversized text under Discord's 4000-char cap", () => {
    const out = legacyToV2({
      embeds: [new EmbedBuilder().setDescription("a".repeat(4096)).addFields({ name: "f", value: "b".repeat(1024) })],
    });
    assertDiscordValidV2("oversized", out);
  });

  it("every /setup wizard step converts to a valid V2 message", () => {
    for (let step = 1; step <= 11; step++) {
      assertDiscordValidV2(`wizard step ${step}`, legacyToV2(wizardStepPayload(clan, step)));
    }
  });

  it("every /setup section converts to a valid V2 message and keeps its buttons", () => {
    for (const [name, build] of Object.entries(__setupSectionsForTest)) {
      const legacy = build(clan);
      const out = legacyToV2(legacy);
      assertDiscordValidV2(name, out);
      const before = JSON.stringify(legacy.components ?? []).match(/"custom_id":"[^"]+"/g) ?? [];
      const after = JSON.stringify(out).match(/"custom_id":"[^"]+"/g) ?? [];
      assert.deepEqual(after.sort(), before.sort(), `${name}: lost a control in conversion`);
    }
  });

  it("the V2 setup hub itself is within Discord limits", () => {
    assertDiscordValidV2("hub", setupMainPayloadV2(clan));
  });
});
