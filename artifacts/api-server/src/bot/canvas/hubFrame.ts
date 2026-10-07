/**
 * Shared hub chrome. One header and one numbered tile so every home screen
 * reads the same way. Gradients and text only — no shadows, no image fetches.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import { ellipsize, roundRectPath, text, PALETTE } from "./theme";
import { font } from "./fonts";

function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return `rgba(63,81,224,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(63,81,224,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function accentRail(ctx: SKRSContext2D, height: number, color: string) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, color);
  g.addColorStop(1, tint(color, 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, height);
}

/**
 * Draws the eyebrow, title, and one or two subtitle lines.
 * Returns the y where the body (tiles) should start.
 */
export function hubHeader(
  ctx: SKRSContext2D,
  opts: {
    eyebrow: string;
    title: string;
    subtitle: string;
    subtitle2?: string;
    width: number;
    accent: string;
    pad?: number;
  }
): number {
  const pad = opts.pad ?? 48;
  text(ctx, opts.eyebrow.toUpperCase(), pad, 46, {
    size: 13,
    weight: "bold",
    color: opts.accent,
    maxWidth: opts.width - pad * 2,
  });
  text(ctx, opts.title, pad, 92, {
    size: 36,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: opts.width - pad * 2,
  });
  ctx.fillStyle = opts.accent;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(pad, 108, 56, 4);
  ctx.globalAlpha = 1;
  text(ctx, opts.subtitle, pad, 142, {
    size: 16,
    color: PALETTE.soft,
    maxWidth: opts.width - pad * 2,
  });
  if (opts.subtitle2) {
    text(ctx, opts.subtitle2, pad, 166, {
      size: 16,
      color: PALETTE.soft,
      maxWidth: opts.width - pad * 2,
    });
    return 198;
  }
  return 176;
}

/** Fill up to `maxLines`, keeping every word that fits on the last line. */
function fitLines(ctx: SKRSContext2D, value: string, maxWidth: number, maxLines: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i]!;
    const attempt = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(attempt).width > maxWidth) {
      lines.push(current);
      current = "";
      if (lines.length === maxLines) break;
      i -= 1;
      continue;
    }
    current = attempt;
  }
  if (lines.length < maxLines && current) {
    lines.push(i < words.length ? ellipsize(ctx, `${current} ${words.slice(i).join(" ")}`, maxWidth) : current);
  } else if (lines.length === maxLines && i < words.length) {
    const last = lines[maxLines - 1] ?? "";
    lines[maxLines - 1] = ellipsize(ctx, `${last} ${words.slice(i).join(" ")}`, maxWidth);
  }
  return lines;
}

/** A quiet numbered tile. `n` is shown as 01, 02, … */
export function numberedTile(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  n: number,
  kicker: string,
  title: string,
  detail: string,
  accent: string
) {
  const showMark = w >= 250 && h >= 168;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.clip();
  ctx.fillStyle = PALETTE.card;
  ctx.fill();
  const wash = ctx.createLinearGradient(x, y, x + w, y + h);
  wash.addColorStop(0, tint(accent, 0.14));
  wash.addColorStop(0.45, tint(accent, 0.04));
  wash.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(x, y, w, h);
  if (showMark) {
    text(ctx, String(n).padStart(2, "0"), x + w - 14, y + h - 10, {
      size: Math.min(72, Math.floor(h * 0.4)),
      weight: "bold",
      color: tint(accent, 0.2),
      align: "right",
    });
  }
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 6, h);
  ctx.restore();

  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 18);
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  text(ctx, String(n).padStart(2, "0"), x + 22, y + 34, {
    size: 16,
    weight: "bold",
    color: accent,
  });
  text(ctx, kicker.toUpperCase(), x + 56, y + 34, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
    maxWidth: w - 78,
  });
  text(ctx, title, x + 22, y + 70, {
    size: 22,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: w - (showMark ? 96 : 40),
  });

  ctx.font = font(15, "regular", "display");
  const detailWidth = w - (showMark ? 100 : 44);
  const lines = fitLines(ctx, detail, detailWidth, h >= 190 ? 3 : 2);
  lines.forEach((line, i) => {
    text(ctx, line, x + 22, y + 100 + i * 22, {
      size: 15,
      color: PALETTE.soft,
      maxWidth: w - (showMark ? 100 : 44),
    });
  });
}
