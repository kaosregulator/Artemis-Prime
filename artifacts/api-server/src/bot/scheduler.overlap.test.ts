import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getJobMetrics, recordSchedulerTick } from "../lib/diagnostics.js";

describe("scheduler overlap metrics", () => {
  it("records skipped overlaps separately from completed ticks", () => {
    const before = getJobMetrics();
    recordSchedulerTick({ durationMs: 0, skippedOverlap: true });
    recordSchedulerTick({ durationMs: 12, failed: false });
    const after = getJobMetrics();
    assert.equal(after.tickOverlapsSkipped, before.tickOverlapsSkipped + 1);
    assert.equal(after.ticks, before.ticks + 1);
    assert.equal(after.lastTickDurationMs, 12);
  });
});
