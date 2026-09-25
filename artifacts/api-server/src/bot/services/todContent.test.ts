import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILTIN_TOD_CONTENT,
  pickContent,
  rewardFor,
  spinWheel,
  DIFFICULTY_REWARDS,
} from "./tod/content.js";

function clampAltCount(n: number): number | null {
  if (!Number.isInteger(n) || n < 1 || n > 100) return null;
  return n;
}

describe("tod content registry", () => {
  it("has truths and dares across categories", () => {
    assert.ok(BUILTIN_TOD_CONTENT.some((c) => c.type === "truth"));
    assert.ok(BUILTIN_TOD_CONTENT.some((c) => c.type === "dare"));
    assert.ok(BUILTIN_TOD_CONTENT.some((c) => c.category === "irl"));
  });

  it("picks typed content", () => {
    const t = pickContent({ type: "truth" });
    assert.equal(t?.type, "truth");
    const d = pickContent({ type: "dare", category: "funny" });
    assert.equal(d?.type, "dare");
    assert.equal(d?.category, "funny");
  });

  it("rewards match difficulty table", () => {
    const item = BUILTIN_TOD_CONTENT.find((c) => c.difficulty === "hard" && c.type === "dare");
    assert.ok(item);
    assert.equal(rewardFor(item!), DIFFICULTY_REWARDS.hard.dare);
  });

  it("spin returns a known outcome", () => {
    const o = spinWheel();
    assert.ok(o.key);
    assert.ok(o.emoji);
  });
});

describe("alt count clamp", () => {
  it("clamps alt counts to 1–100", () => {
    assert.equal(clampAltCount(1), 1);
    assert.equal(clampAltCount(100), 100);
    assert.equal(clampAltCount(0), null);
    assert.equal(clampAltCount(101), null);
    assert.equal(clampAltCount(12.5), null);
  });
});
