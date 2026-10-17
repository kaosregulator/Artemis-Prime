import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { warnBoardAudience } from "./warnBoardAudience";
import { parseWarnBoardArg } from "./warnBoard";
import { shouldHoldWarningRole, WARNING_ROLE_ACTIVE_COUNT } from "../services/warningRole";

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
});
