import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { warnBoardAudience } from "./warnBoardAudience";

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
