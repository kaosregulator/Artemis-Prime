import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors classification used in serviceOrders — keep in sync. */
function discordErrorCode(err: unknown): number | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "number" ? code : null;
  }
  return null;
}

function isPermanentDiscordRefError(code: number | null): boolean {
  return code === 10003 || code === 10008 || code === 50001;
}

describe("Discord permanent ref errors", () => {
  it("detects Unknown Channel / Message / Missing Access", () => {
    assert.equal(isPermanentDiscordRefError(discordErrorCode({ code: 10003 })), true);
    assert.equal(isPermanentDiscordRefError(discordErrorCode({ code: 10008 })), true);
    assert.equal(isPermanentDiscordRefError(discordErrorCode({ code: 50001 })), true);
  });

  it("treats rate limits and network noise as transient", () => {
    assert.equal(isPermanentDiscordRefError(discordErrorCode({ code: 429 })), false);
    assert.equal(isPermanentDiscordRefError(discordErrorCode(new Error("fetch failed"))), false);
    assert.equal(isPermanentDiscordRefError(null), false);
  });
});
