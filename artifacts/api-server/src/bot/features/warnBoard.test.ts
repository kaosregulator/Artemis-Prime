import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { warnBoardAudience } from "./warnBoardAudience";
import { assertUniqueCustomIds, parseWarnBoardArg } from "./warnBoard";
import { shouldHoldWarningRole, WARNING_ROLE_ACTIVE_COUNT } from "../services/warningRole";
import { dashBoardPage, dashBoardView, DASH_HOME } from "../ui/ids";

describe("warn board audience", () => {
  it("does not list anyone until an activity track role is configured", () => {
    const result = warnBoardAudience({
      requiredRoleId: null,
      roleOnServer: false,
      memberIds: ["former-member"],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /track role/i);
  });

  it("does not list anyone when the configured role is gone from the server", () => {
    const result = warnBoardAudience({
      requiredRoleId: "role-1",
      roleOnServer: false,
      memberIds: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /isn't on this server/);
  });

  it("keeps only the ids passed in for the live role", () => {
    const result = warnBoardAudience({
      requiredRoleId: "role-1",
      roleOnServer: true,
      memberIds: ["still-tracked"],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.memberIds, ["still-tracked"]);
  });

  it("parses page and view custom ids without colliding", () => {
    assert.deepEqual(parseWarnBoardArg(undefined), { view: "active", page: 0 });
    assert.deepEqual(parseWarnBoardArg("3"), { view: "active", page: 3 });
    assert.deepEqual(parseWarnBoardArg("active-p2"), { view: "active", page: 2 });
    assert.deepEqual(parseWarnBoardArg("life-p0"), { view: "lifetime", page: 0 });
    assert.deepEqual(parseWarnBoardArg("active-v"), { view: "active", page: 0 });
    assert.deepEqual(parseWarnBoardArg("life-v"), { view: "lifetime", page: 0 });
    // Legacy args from the broken PR still open the right view.
    assert.deepEqual(parseWarnBoardArg("life-2"), { view: "lifetime", page: 2 });
    assert.deepEqual(parseWarnBoardArg("active-1"), { view: "active", page: 1 });
  });

  it("uses distinct custom ids for Active toggle and Prev on page 0", () => {
    const activeToggle = dashBoardView("active");
    const prevOnPage0 = dashBoardPage(-1, "active"); // Math.max(0, -1) → page 0
    const nextOnPage0 = dashBoardPage(1, "active");
    assert.equal(activeToggle, "dash:board:active-v");
    assert.equal(prevOnPage0, "dash:board:active-p0");
    assert.equal(nextOnPage0, "dash:board:active-p1");
    assert.notEqual(activeToggle, prevOnPage0);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(dashBoardView("active")).setStyle(ButtonStyle.Danger).setLabel("Active"),
      new ButtonBuilder().setCustomId(dashBoardView("lifetime")).setStyle(ButtonStyle.Secondary).setLabel("Lifetime"),
      new ButtonBuilder().setCustomId(DASH_HOME).setStyle(ButtonStyle.Secondary).setLabel("Overview")
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(dashBoardPage(0, "active")).setStyle(ButtonStyle.Secondary).setLabel("Prev"),
      new ButtonBuilder().setCustomId(dashBoardPage(1, "active")).setStyle(ButtonStyle.Secondary).setLabel("Next")
    );
    assert.doesNotThrow(() => assertUniqueCustomIds([row1, row2]));
  });

  it("rejects duplicate custom ids the way Discord would", () => {
    const dup = "dash:board:active-0";
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(dup).setStyle(ButtonStyle.Danger).setLabel("Active")
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(dup).setStyle(ButtonStyle.Secondary).setLabel("Prev")
    );
    assert.throws(() => assertUniqueCustomIds([row1, row2]), /Duplicate Discord custom_id/);
  });

  it("holds the warning role only at two active warnings", () => {
    assert.equal(WARNING_ROLE_ACTIVE_COUNT, 2);
    assert.equal(shouldHoldWarningRole(0), false);
    assert.equal(shouldHoldWarningRole(1), false);
    assert.equal(shouldHoldWarningRole(2), true);
    assert.equal(shouldHoldWarningRole(4), true);
  });

  it("allows an empty live role so former members are not filled in", () => {
    const result = warnBoardAudience({
      requiredRoleId: "role-1",
      roleOnServer: true,
      memberIds: [],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.memberIds, []);
  });
});
