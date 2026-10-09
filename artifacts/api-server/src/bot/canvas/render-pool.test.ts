import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  getRenderPoolMetrics,
  renderOffThread,
  __resetRenderPoolForTests,
  shutdownRenderPool,
} from "./render-pool.js";

describe("render-pool metrics and backpressure", () => {
  beforeEach(async () => {
    await shutdownRenderPool().catch(() => undefined);
    __resetRenderPoolForTests();
  });

  it("exposes zeroed metrics before any work", () => {
    const m = getRenderPoolMetrics();
    assert.equal(m.completed, 0);
    assert.equal(m.failed, 0);
    assert.equal(m.timeouts, 0);
    assert.equal(m.queued, 0);
    assert.equal(m.active, 0);
  });

  it("rejects when shutting down", async () => {
    await shutdownRenderPool();
    await assert.rejects(
      () => renderOffThread("serviceOrderCard", {}),
      /shutting down/i
    );
  });
});
