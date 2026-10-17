import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { warnBoardAudience } from "./warnBoardAudience";
import { filterRowsToTrackRole, parseWarnBoardArg } from "./warnBoard";
import { shouldHoldWarningRole, WARNING_ROLE_ACTIVE_COUNT } from "../services/warningRole";

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

  it("opens the active list from a bare page number", () => {
    assert.deepEqual(parseWarnBoardArg(undefined), { view: "active", page: 0 });
    assert.deepEqual(parseWarnBoardArg("3"), { view: "active", page: 3 });
    assert.deepEqual(parseWarnBoardArg("life-2"), { view: "lifetime", page: 2 });
    assert.deepEqual(parseWarnBoardArg("active-1"), { view: "active", page: 1 });
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
