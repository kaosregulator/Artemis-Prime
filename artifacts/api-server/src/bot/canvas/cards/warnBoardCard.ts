/**
 * Staff board — who has the most saved warnings, and who has been reminded
 * the most. Separate from the clan-points / clean-standing leaderboard.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawSquareAvatar,
  toPng,
  PALETTE,
} from "../theme";

export interface WarnBoardRow {
  rank: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  robloxAvatarUrl: string | null;
  count: number;
  /** Secondary line, e.g. "2 active" or "reminders". */
  detail: string;
}

export interface WarnBoardView {
  communityName: string;
  activityName: string;
  warned: WarnBoardRow[];
  reminded: WarnBoardRow[];
}

const W = 1100;

async function drawRow(
  ctx: SKRSContext2D,
  row: WarnBoardRow,
  x: number,
  y: number,
  w: number,
  accent: string
) {
  card(ctx, x, y, w, 64, { radius: 10, shadow: false });
  text(ctx, String(row.rank).padStart(2, "0"), x + 16, y + 40, {
    size: 16,
    weight: "bold",
    color: accent,
  });
  const roblox = row.robloxAvatarUrl;
  const discord = row.avatarUrl;
  let nameX = x + 108;
  if (roblox && discord) {
    const dImg = await fetchAvatar(discord);
    const rImg = await fetchAvatar(roblox);
    drawSquareAvatar(ctx, dImg, x + 52, y + 10, 44, row.username[0] ?? "?", PALETTE.blurpleSoft, 8);
    drawSquareAvatar(ctx, rImg, x + 100, y + 10, 44, "R", "#00a2ff", 8);
    nameX = x + 156;
  } else {
    const img = await fetchAvatar(roblox || discord);
    drawSquareAvatar(ctx, img, x + 52, y + 10, 44, row.username[0] ?? "?", PALETTE.blurpleSoft, 8);
  }
  text(ctx, row.displayName || row.username, nameX, y + 28, {
    size: 16,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: w - (nameX - x) - 88,
  });
  text(ctx, row.detail, nameX, y + 50, {
    size: 13,
    color: PALETTE.muted,
    maxWidth: w - (nameX - x) - 88,
  });
  text(ctx, String(row.count), x + w - 18, y + 40, {
    size: 22,
    weight: "bold",
    color: PALETTE.text,
    align: "right",
  });
}

export async function renderWarnBoardCard(view: WarnBoardView): Promise<Buffer> {
  const rows = Math.max(view.warned.length, view.reminded.length, 1);
  const H = 250 + rows * 74 + 70;
  const rc = createSurface(W, Math.max(H, 420));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.communityName.toUpperCase(), 44, 44, {
    size: 15,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, "Warnings & reminders", 44, 90, {
    size: 36,
    weight: "bold",
    color: PALETTE.text,
  });
  text(
    ctx,
    `Saved history for ${view.activityName}. Most warned on the left, most reminded on the right. Clan points are separate.`,
    44,
    128,
    { size: 16, color: PALETTE.soft, maxWidth: W - 88 }
  );

  const colW = (W - 44 * 2 - 24) / 2;
  const leftX = 44;
  const rightX = 44 + colW + 24;
  let y = 168;

  text(ctx, "MOST WARNED", leftX, y, { size: 14, weight: "bold", color: PALETTE.red });
  text(ctx, "MOST REMINDED", rightX, y, { size: 14, weight: "bold", color: PALETTE.amber });
  y += 18;

  if (!view.warned.length && !view.reminded.length) {
    text(ctx, "No warnings or reminders saved yet.", 44, y + 40, {
      size: 18,
      color: PALETTE.soft,
    });
  } else {
    for (let i = 0; i < rows; i++) {
      const warned = view.warned[i];
      const reminded = view.reminded[i];
      if (warned) await drawRow(ctx, warned, leftX, y, colW, PALETTE.red);
      else if (i === 0 && !view.warned.length) {
        text(ctx, "No warnings saved yet.", leftX, y + 36, { size: 15, color: PALETTE.muted });
      }
      if (reminded) await drawRow(ctx, reminded, rightX, y, colW, PALETTE.amber);
      else if (i === 0 && !view.reminded.length) {
        text(ctx, "No reminders saved yet.", rightX, y + 36, { size: 15, color: PALETTE.muted });
      }
      y += 74;
    }
  }

  text(
    ctx,
    "Lifetime warnings include ones already cleared. Award clan points separately — they are not these counts.",
    44,
    rc.height - 36,
    { size: 14, color: PALETTE.muted, maxWidth: W - 88 }
  );

  return toPng(rc.canvas);
}
