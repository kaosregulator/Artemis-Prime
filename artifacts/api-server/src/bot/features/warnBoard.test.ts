import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { warnBoardAudience } from "./warnBoardAudience";
import { assertUniqueCustomIds, filterRowsToTrackRole, parseWarnBoardArg } from "./warnBoard";
import { shouldHoldWarningRole, WARNING_ROLE_ACTIVE_COUNT } from "../services/warningRole";
import { dashBoardPage, dashBoardView, DASH_HOME } from "../ui/ids";

function fakeGuild(opts: {
  members: Array<{ id: string; bot?: boolean; roleIds: string[]; displayName?: string; username?: string }>;
}) {
  const cache = new Map(
    opts.members.map((m) => [
      m.id,
      {
        id: m.id,
        user: { bot: !!m.bot, username: m.username ?? m.id },
        displayName: m.displayName ?? m.username ?? m.id,
        roles: { cache: { has: (roleId: string) => m.roleIds.includes(roleId) } },
      },
    ])
  );
  return {
    members: {
      cache: {
        get: (id: string) => cache.get(id),
      },
      fetch: async () => cache,
    },
  } as unknown as import("discord.js").Guild;
}

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

  it("keeps Active toggle distinct from Prev on page 0 (the /warnboard crash)", () => {
    const activeToggle = dashBoardView("active");
    const prevOnPage0 = dashBoardPage(-1, "active"); // Math.max(0, -1) → page 0
    const nextOnPage0 = dashBoardPage(1, "active");
    assert.equal(activeToggle, "dash:board:active-v");
    assert.equal(prevOnPage0, "dash:board:active-p0");
    assert.equal(nextOnPage0, "dash:board:active-p1");
    assert.notEqual(activeToggle, prevOnPage0);

    // Exact layout /warnboard sends on first open (page 0, one page).
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

  it("rejects duplicate custom ids the way Discord would (50035)", () => {
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

  it("keeps only ranked people who still hold the track role", async () => {
    const guild = fakeGuild({
      members: [
        { id: "a", roleIds: ["track"], displayName: "Alpha" },
        { id: "b", roleIds: [], displayName: "LeftRole" },
        { id: "c", roleIds: ["track"], bot: true, displayName: "Bot" },
        { id: "d", roleIds: ["track"], displayName: "Delta" },
      ],
    });
    const ranked = [
      { userId: "a", n: 3 },
      { userId: "b", n: 9 },
      { userId: "c", n: 2 },
      { userId: "d", n: 1 },
      { userId: "missing", n: 5 },
    ];
    const { rows, names } = await filterRowsToTrackRole(guild, "track", ranked, 100);
    assert.deepEqual(
      rows.map((r) => r.userId),
      ["a", "d"]
    );
    assert.equal(names.get("a"), "Alpha");
    assert.equal(names.get("d"), "Delta");
    assert.equal(names.has("b"), false);
  });

  it("stops at the display limit after filtering", async () => {
    const guild = fakeGuild({
      members: [
        { id: "1", roleIds: ["track"] },
        { id: "2", roleIds: ["track"] },
        { id: "3", roleIds: ["track"] },
      ],
    });
    const ranked = [
      { userId: "1" },
      { userId: "2" },
      { userId: "3" },
    ];
    const { rows } = await filterRowsToTrackRole(guild, "track", ranked, 2);
    assert.deepEqual(
      rows.map((r) => r.userId),
      ["1", "2"]
    );
  });
});
