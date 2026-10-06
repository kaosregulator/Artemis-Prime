/**
 * Shared color tokens for Discord embeds and canvas cards.
 *
 * Kept free of `@napi-rs/canvas` so the bot worker can import colors for
 * embeds without loading native canvas bindings into the Discord event-loop
 * process (renders run in the dedicated render worker).
 */
export const PALETTE = {
  bg0: "#dfe3ec", // deepest tone (gradient fallbacks)
  bg1: "#eef1f6", // tile fill
  card: "#ffffff", // main panel
  cardAlt: "#e7eaf1", // progress track / secondary fill
  border: "#d3d8e4",
  borderSoft: "#e3e7f0",
  text: "#14161f", // ink
  soft: "#454b5c", // secondary ink
  muted: "#7c8397", // tertiary / labels
  blurple: "#3f51e0",
  blurpleSoft: "#6f8bff",
  violet: "#8b3ff0",
  cyan: "#0e9cbb",
  green: "#2e9e57",
  greenBright: "#1fae63",
  amber: "#c9820a",
  red: "#e11d2b",
} as const;

export type RGB = string;
