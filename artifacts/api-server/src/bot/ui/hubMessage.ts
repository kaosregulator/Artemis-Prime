import type { BaseMessageOptions, InteractionEditReplyOptions } from "discord.js";
import { asCanvasHubV2, replaceHubCardV2 } from "./v2/hubChrome";
import { V2_ACCENT, statePanel, type V2Accent } from "./v2/primitives";

/**
 * Discord keeps previous file attachments when a message is edited unless they
 * are explicitly cleared. Canvas hubs replace the card image on every navigate
 * — without `attachments: []`, PNGs stack and every image command looks broken.
 *
 * Canvas hubs are upgraded to Components V2 chrome (Media Gallery + rows)
 * so Scout / Roblox / Link / Market share one uniform look.
 */
export function replaceHubCard(
  payload: BaseMessageOptions,
  opts?: { title?: string; subtitle?: string; accent?: V2Accent }
): InteractionEditReplyOptions {
  return replaceHubCardV2(payload, opts);
}

/** Error / empty reply that also drops any stacked canvas attachments. */
export function clearHubCard(content: string): InteractionEditReplyOptions {
  return {
    ...statePanel({ kind: "error", body: content }),
    attachments: [],
    embeds: [],
    content: undefined,
  } as InteractionEditReplyOptions;
}

/** Initial reply helper for canvas hubs (send or editReply). */
export function hubCardPayload(
  payload: BaseMessageOptions,
  opts?: { title?: string; subtitle?: string; accent?: V2Accent }
): BaseMessageOptions {
  return asCanvasHubV2(payload, {
    accent: opts?.accent ?? V2_ACCENT.brand,
    ...opts,
  });
}
