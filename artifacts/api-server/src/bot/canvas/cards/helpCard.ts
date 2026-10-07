import { createSurface, paintBackground, text, PALETTE, toPng } from "../theme";
import { accentRail, hubHeader, numberedTile } from "../hubFrame";

export interface HelpSection {
  title: string;
  accent: string;
  lines: string[];
}

export interface HelpCardView {
  communityName: string;
  activityName: string;
  /** Game name, used in the one-line explanation. */
  gameName?: string;
  sections: HelpSection[];
}

/**
 * Organized start-here card. Four numbered steps, same chrome as the hubs.
 * `sections` supplies the step copy (kicker, title, detail) so /help stays the
 * single source of the words.
 */
export async function renderHelpCard(view: HelpCardView): Promise<Buffer> {
  const W = 1100;
  const H = 720;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  accentRail(ctx, H, PALETTE.blurple);

  const game = view.gameName?.trim() || "your game";
  const bodyY = hubHeader(ctx, {
    eyebrow: view.communityName,
    title: "Start here",
    subtitle: `${view.activityName} is what people do in ${game}.`,
    subtitle2: "A warning is a message. Clan points are awards staff give out.",
    width: W,
    accent: PALETTE.blurple,
  });

  const steps = view.sections.slice(0, 4);
  const colW = (W - 96 - 20) / 2;
  const tileH = 200;
  steps.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 48 + col * (colW + 20);
    const y = bodyY + row * (tileH + 16);
    const [title, detail] = s.lines;
    numberedTile(ctx, x, y, colW, tileH, i + 1, s.title, title ?? "", detail ?? "", s.accent);
  });

  text(ctx, "Each step names the command to run. Nothing here is locked to one server.", 48, H - 28, {
    size: 15,
    color: PALETTE.muted,
    maxWidth: W - 96,
  });

  return toPng(rc.canvas);
}
