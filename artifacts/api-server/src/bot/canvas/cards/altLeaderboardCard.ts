/**
 * Alt-board leaderboard — circular avatars, podium 2-1-3, shiny rank emblems.
 * Prefer linked Roblox avatars; fall back to Discord. Avatars are letterboxed
 * (contain) so faces are never cropped off.
 */
import type { Image, SKRSContext2D } from "@napi-rs/canvas";
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  toPng,
  PALETTE,
} from "../theme";

export interface AltLeaderboardRow {
  rank: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  robloxAvatarUrl?: string | null;
  discordAvatarUrl?: string | null;
  altCount: number;
}

export interface AltLeaderboardCardView {
  communityName: string;
  mode: "today" | "alltime";
  activityDate: string;
  allTimeHigh: number;
  podium: AltLeaderboardRow[];
  rows: AltLeaderboardRow[];
}

const RANK_RING: Record<number, string> = {
  1: "#f1c40f",
  2: "#bdc3c7",
  3: "#cd7f32",
};

/** Circular avatar with contain fit (no crop) + shiny rank ring. */
async function drawCircleAvatar(
  ctx: SKRSContext2D,
  url: string | null,
  cx: number,
  cy: number,
  size: number,
  initial: string,
  ring: string
) {
  const img = await fetchAvatar(url, 8000);
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = PALETTE.bg1;
  ctx.fillRect(cx - r, cy - r, size, size);
  if (img) {
    drawContain(ctx, img, cx - r, cy - r, size, size);
  } else {
    ctx.fillStyle = PALETTE.cardAlt;
    ctx.fillRect(cx - r, cy - r, size, size);
    text(ctx, (initial || "?").toUpperCase().slice(0, 1), cx, cy, {
      size: size * 0.4,
      weight: "bold",
      color: PALETTE.soft,
      align: "center",
      baseline: "middle",
    });
  }
  ctx.restore();

  // Outer glow ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawContain(
  ctx: SKRSContext2D,
  img: Image,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function rankBadge(ctx: SKRSContext2D, rank: number, x: number, y: number) {
  const label = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
  // Canvas fonts often miss emoji — draw a metallic number badge instead.
  const colors = RANK_RING[rank] ?? PALETTE.blurple;
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fillStyle = colors;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, String(rank), x, y, {
    size: 18,
    weight: "bold",
    color: "#1a1a1a",
    align: "center",
    baseline: "middle",
  });
  void label;
}

export async function renderAltLeaderboardCard(
  view: AltLeaderboardCardView
): Promise<Buffer> {
  const W = 1000;
  const listCount = Math.min(view.rows.length, 10);
  const podiumH = view.podium.length ? 300 : 0;
  const H = 220 + podiumH + listCount * 72 + 60;
  const rc = createSurface(W, Math.max(H, 520));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, (view.communityName || "CLAN").toUpperCase(), 44, 40, {
    size: 14,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(
    ctx,
    view.mode === "today" ? "ALT BOARD · TODAY" : "ALT BOARD · ALL-TIME",
    44,
    78,
    { size: 32, weight: "bold", color: PALETTE.text }
  );
  text(
    ctx,
    view.mode === "today"
      ? `Activity day ${view.activityDate} · Patriots & Guardians`
      : `All-time high: ${view.allTimeHigh} alts · linked Roblox faces preferred`,
    44,
    116,
    { size: 16, color: PALETTE.soft, maxWidth: W - 88 }
  );

  if (view.podium.length) {
    text(ctx, "TOP 3", 44, 160, {
      size: 13,
      weight: "bold",
      color: PALETTE.blurple,
    });

    // Layout: 2nd · 1st · 3rd
    const spots = [
      { x: 80, y: 210, size: 88, rank: 2 },
      { x: W / 2, y: 190, size: 112, rank: 1 },
      { x: W - 80, y: 220, size: 88, rank: 3 },
    ];
    const byRank = [
      view.podium.find((p) => p.rank === 2),
      view.podium.find((p) => p.rank === 1),
      view.podium.find((p) => p.rank === 3),
    ];

    for (let i = 0; i < 3; i++) {
      const row = byRank[i];
      const spot = spots[i]!;
      if (!row) continue;
      const url = row.robloxAvatarUrl || row.avatarUrl || row.discordAvatarUrl;
      await drawCircleAvatar(
        ctx,
        url ?? null,
        spot.x,
        spot.y + spot.size / 2,
        spot.size,
        row.displayName[0] ?? "?",
        RANK_RING[spot.rank]!
      );
      rankBadge(ctx, spot.rank, spot.x + spot.size / 2 - 8, spot.y + 8);
      text(ctx, row.displayName, spot.x, spot.y + spot.size + 28, {
        size: spot.rank === 1 ? 18 : 15,
        weight: "bold",
        color: PALETTE.text,
        align: "center",
        maxWidth: 200,
      });
      text(ctx, `${row.altCount} alts`, spot.x, spot.y + spot.size + 52, {
        size: 14,
        color: PALETTE.blurple,
        align: "center",
      });
    }
  }

  let y = 180 + podiumH;
  for (const row of view.rows.slice(0, 10)) {
    card(ctx, 44, y, W - 88, 64, { radius: 12, fill: PALETTE.bg1 });
    text(ctx, `#${row.rank}`, 64, y + 22, {
      size: 20,
      weight: "bold",
      color: PALETTE.blurple,
    });
    const url = row.robloxAvatarUrl || row.avatarUrl || row.discordAvatarUrl;
    await drawCircleAvatar(
      ctx,
      url ?? null,
      150,
      y + 32,
      44,
      row.displayName[0] ?? "?",
      RANK_RING[row.rank] ?? PALETTE.blurpleSoft
    );
    text(ctx, row.displayName, 186, y + 18, {
      size: 17,
      weight: "bold",
      color: PALETTE.text,
      maxWidth: 480,
    });
    text(ctx, `@${row.username}`, 186, y + 42, {
      size: 13,
      color: PALETTE.muted,
      maxWidth: 400,
    });
    text(ctx, `${row.altCount}`, W - 100, y + 22, {
      size: 22,
      weight: "bold",
      color: PALETTE.text,
      align: "right",
    });
    text(ctx, "alts", W - 100, y + 46, {
      size: 12,
      color: PALETTE.muted,
      align: "right",
    });
    y += 72;
  }

  if (!view.rows.length) {
    card(ctx, 44, y, W - 88, 80, { radius: 12, fill: PALETTE.bg1 });
    text(ctx, "No submissions yet", 70, y + 30, {
      size: 20,
      weight: "bold",
      color: PALETTE.text,
    });
    text(ctx, "Hit Submit alts on the panel to get on the board.", 70, y + 56, {
      size: 14,
      color: PALETTE.muted,
    });
  }

  return toPng(rc.canvas);
}
