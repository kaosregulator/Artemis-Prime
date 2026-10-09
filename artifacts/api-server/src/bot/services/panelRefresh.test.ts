import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOrderMeta, serializeOrderMeta } from "./serviceCatalog.js";

describe("panelUiLocked meta (one-shot Refresh)", () => {
  it("treats missing flag as unlocked (show Refresh on live boards)", () => {
    const meta = parseOrderMeta(serializeOrderMeta({ itemName: "Abrams" }));
    assert.equal(meta?.panelUiLocked, undefined);
    assert.equal(Boolean(meta?.panelUiLocked), false);
  });

  it("locks after Refresh so the button never returns", () => {
    const locked = parseOrderMeta(
      serializeOrderMeta({ itemName: "Abrams", panelUiLocked: true })
    );
    assert.equal(locked?.panelUiLocked, true);
  });
});
