import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageFlags } from "discord.js";
import {
  V2_FLAGS,
  container,
  textDisplay,
  separator,
  v2Message,
  statePanel,
  actionRow,
  v2Button,
} from "./primitives.js";
import { ButtonStyle } from "discord.js";
import { serviceOrderPanelV2 } from "./serviceOrderPanels.js";
import { setupMainPayloadV2 } from "./setupPanels.js";
import type { Clan } from "@workspace/db";

describe("Components V2 primitives", () => {
  it("uses IsComponentsV2 flag", () => {
    assert.equal(V2_FLAGS, MessageFlags.IsComponentsV2);
    const msg = v2Message({
      components: [
        container({
          children: [textDisplay("Hello"), separator()],
        }),
      ],
    });
    assert.equal(msg.flags, MessageFlags.IsComponentsV2);
    assert.ok(Array.isArray(msg.components));
    assert.equal(msg.components!.length, 1);
    // Must not mix embeds/content
    assert.equal((msg as { content?: string }).content, undefined);
    assert.equal((msg as { embeds?: unknown }).embeds, undefined);
  });

  it("builds state panels for error/denied", () => {
    const denied = statePanel({ kind: "denied", body: "Admins only." });
    assert.equal(denied.flags, MessageFlags.IsComponentsV2);
    const err = statePanel({ kind: "error", body: "Try again." });
    assert.equal(err.flags, MessageFlags.IsComponentsV2);
  });

  it("builds action rows with preserved custom ids", () => {
    const row = actionRow(
      v2Button({ customId: "svc:place", label: "Place", style: ButtonStyle.Primary })
    );
    const json = row.toJSON();
    assert.equal(json.components?.[0] && "custom_id" in json.components[0]
      ? json.components[0].custom_id
      : null, "svc:place");
  });
});

describe("service order + setup V2 panels", () => {
  it("builds place-order panel with Place button id", () => {
    const panel = serviceOrderPanelV2(null);
    assert.equal(panel.flags, MessageFlags.IsComponentsV2);
    const raw = JSON.stringify(panel.components);
    assert.match(raw, /svc:place/);
  });

  it("builds setup main panel with finish + wizard ids", () => {
    const clan = {
      clanName: "Test Clan",
      gameName: "Test Game",
      activityName: "XP",
      setupComplete: false,
      weeklyGoal: 1000,
      dailyTarget: 0,
      trackingMode: "exact",
      trackingPeriod: "weekly",
      weekStartDay: 1,
      resetTime: "00:00",
      timezone: "UTC",
      autoWeeklyReset: true,
      archiveWeeks: true,
      remindersEnabled: false,
      reminderDays: [],
      reminderTimes: [],
      warningThreshold: 2,
      escalationThreshold: 3,
      warningRemovalHours: 0,
      cardStyle: "canvas",
      reminderChannelId: null,
      warningChannelId: null,
      logChannelId: null,
      disputeCategoryId: null,
      disputeStaffRoleId: null,
      serviceOrdersEnabled: false,
      serviceOrderChannelId: null,
      serviceOrderCategoryId: null,
      serviceOrderTeamRoleId: null,
      staffRoleIds: [],
      adminRoleIds: [],
      adminUserIds: [],
      requiredRoleId: null,
      guildId: "1",
    } as unknown as Clan;

    const panel = setupMainPayloadV2(clan);
    assert.equal(panel.flags, MessageFlags.IsComponentsV2);
    const raw = JSON.stringify(panel.components);
    assert.match(raw, /setup:finish|SETUP_FINISH|finish/i);
    // Custom ids use setup: namespace from ids.ts
    assert.match(raw, /setup:/);
  });
});
