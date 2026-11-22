import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldHoldWarningRole, WARNING_ROLE_ACTIVE_COUNT } from "./warningRole.js";

const DAY = 86_400_000;
const now = new Date("2026-11-22T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

describe("warning role + cooldown", () => {
  it("keeps today's behavior when the cooldown is off", () => {
    assert.equal(shouldHoldWarningRole(WARNING_ROLE_ACTIVE_COUNT - 1), false);
    assert.equal(shouldHoldWarningRole(WARNING_ROLE_ACTIVE_COUNT), true);
    // Old warnings, cooldown off: role stays until staff clear warnings.
    assert.equal(
      shouldHoldWarningRole({ activeCount: 3, newestActiveAt: daysAgo(400), cooldownDays: 0, now }),
      true
    );
  });

  it("removes the role once the newest warning is older than the cooldown", () => {
    assert.equal(
      shouldHoldWarningRole({ activeCount: 2, newestActiveAt: daysAgo(13), cooldownDays: 14, now }),
      true
    );
    assert.equal(
      shouldHoldWarningRole({ activeCount: 2, newestActiveAt: daysAgo(14), cooldownDays: 14, now }),
      false
    );
  });

  it("a new warning restarts the cooldown", () => {
    assert.equal(
      shouldHoldWarningRole({ activeCount: 3, newestActiveAt: daysAgo(0), cooldownDays: 7, now }),
      true
    );
  });

  it("never grants the role below the threshold, cooldown or not", () => {
    assert.equal(
      shouldHoldWarningRole({ activeCount: 1, newestActiveAt: daysAgo(0), cooldownDays: 30, now }),
      false
    );
  });

  it("fails safe (keeps the role) when the warning date is unknown", () => {
    assert.equal(shouldHoldWarningRole({ activeCount: 2, newestActiveAt: null, cooldownDays: 7, now }), true);
  });
});
