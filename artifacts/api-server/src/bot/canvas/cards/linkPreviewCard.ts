/**
 * Avatar-link preview card — Discord face + Roblox face side by side.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawAvatar,
  toPng,
  PALETTE,
} from "../theme";
import { accentRail, hubHeader } from "../hubFrame";

export interface LinkPreviewCardView {
  title?: string;
  /** Discord username (login handle). Always shown. */
  discordName: string;
  /** Guild nickname when set (often matches Roblox via Bloxlink). */
  discordNickname?: string | null;
  discordAvatarUrl: string | null;
  robloxName: string | null;
  robloxAvatarUrl: string | null;
  robloxUserId?: number | null;
  hint?: string;
  queueLabel?: string | null;
}

export async function renderLinkPreviewCard(view: LinkPreviewCardView): Promise<Buffer> {
  const W = 920;
  const H = 500;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  accentRail(ctx, H, "#00a2ff");

  const nick = view.discordNickname?.trim() || null;
  const username = view.discordName?.trim() || "member";
  const hasDistinctNick = !!nick && nick.toLowerCase() !== username.toLowerCase();
  const discordPrimary = hasDistinctNick ? nick! : username;
  const discordSecondary = hasDistinctNick ? `@${username}` : null;
  const discordInitial = discordPrimary[0] ?? "?";

  const bodyY = hubHeader(ctx, {
    eyebrow: "Link",
    title: view.title ?? "Match Discord to Roblox",
    subtitle:
      view.hint ?? "Discord on the left, Roblox on the right. Bloxlink nicks usually match.",
    width: W,
    accent: "#0074bd",
    pad: 44,
  });

  card(ctx, 44, bodyY, 390, 250, { radius: 20, shadow: false });
  card(ctx, 486, bodyY, 390, 250, { radius: 20, shadow: false });

  const [dImg, rImg] = await Promise.all([
    fetchAvatar(view.discordAvatarUrl),
    fetchAvatar(view.robloxAvatarUrl),
  ]);

  drawAvatar(ctx, dImg, 170, bodyY + 16, 120, discordInitial, PALETTE.blurpleSoft);
  text(ctx, "1  DISCORD", 64, bodyY + 168, { size: 13, weight: "bold", color: PALETTE.muted });
  text(ctx, discordPrimary, 64, bodyY + 198, {
    size: 22,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: 340,
  });
  if (discordSecondary) {
    text(ctx, discordSecondary, 64, bodyY + 224, {
      size: 15,
      color: PALETTE.muted,
      maxWidth: 340,
    });
  }

  drawAvatar(ctx, rImg, 612, bodyY + 16, 120, (view.robloxName ?? "R")[0] ?? "R", "#00a2ff");
  text(ctx, "2  ROBLOX", 506, bodyY + 168, { size: 13, weight: "bold", color: PALETTE.muted });
  text(ctx, view.robloxName ?? "Not linked yet", 506, bodyY + 198, {
    size: 22,
    weight: "bold",
    color: view.robloxName ? PALETTE.text : PALETTE.muted,
    maxWidth: 340,
  });

  if (view.queueLabel) {
    text(ctx, view.queueLabel, 44, H - 28, { size: 14, color: PALETTE.muted, maxWidth: W - 88 });
  } else if (view.robloxUserId) {
    text(ctx, `Roblox ID ${view.robloxUserId}`, 44, H - 28, {
      size: 14,
      color: PALETTE.muted,
    });
  }

  return toPng(rc.canvas);
}
