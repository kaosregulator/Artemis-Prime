import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Clan } from "@workspace/db";
import { buildPlan, rollCallCopy, suggestAction, type RollFacts } from "./rollCall.js";
import { __rollCallForTest } from "../features/rollCall.js";

const now = new Date("2026-11-22T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
const base: RollFacts = {
  userId: "1", name: "kaos", isBot: false, immuneReason: null,
  lastReminderAt: null, lastReminderBy: null, lastWarningAt: null, lastWarningBy: null, activeCount: 0,
};
const clan = { warningRoleIds: ["99"] } as unknown as Clan;

describe("roll call suggestions (order, not a time window)", () => {
  it("first time → reminder", () => {
    assert.equal(suggestAction(base, now).action, "reminder");
  });
  it("open reminder → warning, no matter how old", () => {
    assert.equal(suggestAction({ ...base, lastReminderAt: ago(24 * 90) }, now).action, "warning");
    assert.equal(suggestAction({ ...base, lastReminderAt: ago(30) }, now).action, "warning");
  });
  it("reminder already followed by a warning → back to a reminder", () => {
    const f = { ...base, lastReminderAt: ago(200), lastWarningAt: ago(100), activeCount: 1 };
    assert.equal(suggestAction(f, now).action, "reminder");
  });
  it("handled in the last few hours → skip (two officers, back to back)", () => {
    assert.equal(suggestAction({ ...base, lastReminderAt: ago(1), lastReminderBy: "Maya" }, now).action, "skip");
    assert.match(suggestAction({ ...base, lastReminderAt: ago(1), lastReminderBy: "Maya" }, now).why, /by Maya/);
  });
  it("leave / exempt and bots → skip", () => {
    assert.equal(suggestAction({ ...base, immuneReason: "on leave" }, now).action, "skip");
    assert.equal(suggestAction({ ...base, isBot: true }, now).action, "skip");
  });
});

describe("roll call plan", () => {
  it("staff changes win, except for bots", () => {
    const plan = buildPlan(clan, [base, { ...base, userId: "2", isBot: true }], new Map([["1", "warning"], ["2", "warning"]]), now);
    assert.equal(plan[0]!.action, "warning");
    assert.match(plan[0]!.why, /changed by staff/);
    assert.equal(plan[1]!.action, "skip");
  });
  it("flags only the warning that turns the role on", () => {
    const plan = buildPlan(clan, [
      { ...base, userId: "a", lastReminderAt: ago(50), activeCount: 1 },
      { ...base, userId: "b", lastReminderAt: ago(50), activeCount: 0 },
      { ...base, userId: "c", lastReminderAt: ago(50), activeCount: 3 },
    ], new Map(), now);
    assert.deepEqual(plan.map((e) => e.getsRole), [true, false, false]);
    assert.equal(buildPlan({ warningRoleIds: [] } as unknown as Clan, [{ ...base, lastReminderAt: ago(50), activeCount: 1 }], new Map(), now)[0]!.getsRole, false);
  });
  it("member copy has no quota language", () => {
    const text = Object.values(rollCallCopy("Combat Support")).join(" ").toLowerCase();
    for (const banned of ["threshold", "goal", "quota", "requirement", "failure", "xp/"]) {
      assert.ok(!text.includes(banned), `copy contains "${banned}"`);
    }
  });
});

describe("roll call preview stays inside Discord's limits", () => {
  it("25 people with a long note", async () => {
    const facts: RollFacts[] = Array.from({ length: 25 }, (_, i) => ({
      ...base,
      userId: String(100000000000000000n + BigInt(i)),
      name: `Member with a fairly long display name ${i}`,
      lastReminderAt: i % 2 ? ago(48) : null,
      lastReminderBy: "Officer",
      activeCount: i % 3,
    }));
    const s = {
      ownerId: "o", guildId: "g", categoryKey: "xp", categoryLabel: "Combat Support",
      people: [], facts, overrides: new Map(), picked: [], note: "n".repeat(400),
      posting: false, posted: null, ts: Date.now(),
    };
    const out = await __rollCallForTest.previewScreen("tok", s as never, clan);
    const json = JSON.parse(JSON.stringify(out.components));
    let count = 0, text = 0;
    const ids: string[] = [];
    const walk = (n: Record<string, unknown>) => {
      count++;
      if (typeof n.content === "string") text += n.content.length;
      if (typeof n.custom_id === "string") ids.push(n.custom_id);
      for (const k of ["components", "accessory"]) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach((c) => walk(c));
      }
    };
    json.forEach(walk);
    assert.ok(count <= 40, `${count} components`);
    assert.ok(text <= 4000, `${text} text chars`);
    assert.equal(new Set(ids).size, ids.length, "duplicate custom_id");
  });
});
