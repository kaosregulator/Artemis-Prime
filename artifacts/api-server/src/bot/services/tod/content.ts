/**
 * Built-in Truth or Dare content registry.
 * Expand here — do not dump hundreds of prompts into command handlers.
 * Guilds can also add custom rows via tod_custom_content.
 */
export type TodDifficulty = "easy" | "medium" | "hard" | "extreme" | "unhinged";
export type TodContentType = "truth" | "dare";

export interface TodContentItem {
  id: string;
  type: TodContentType;
  category: string;
  difficulty: TodDifficulty;
  text: string;
  requiresProof?: boolean;
  enabled?: boolean;
}

export const DIFFICULTY_REWARDS: Record<TodDifficulty, { truth: number; dare: number }> = {
  easy: { truth: 100, dare: 150 },
  medium: { truth: 200, dare: 300 },
  hard: { truth: 350, dare: 500 },
  extreme: { truth: 1000, dare: 1000 },
  unhinged: { truth: 2000, dare: 2000 },
};

export const DIFFICULTY_EMOJI: Record<TodDifficulty, string> = {
  easy: "🟢",
  medium: "🟡",
  hard: "🟠",
  extreme: "🔴",
  unhinged: "💀",
};

const TRUTHS: TodContentItem[] = [
  { id: "t_f1", type: "truth", category: "funny", difficulty: "easy", text: "What's the weirdest thing you've ever Googled?" },
  { id: "t_f2", type: "truth", category: "funny", difficulty: "easy", text: "What's a song you secretly love but pretend not to?" },
  { id: "t_f3", type: "truth", category: "funny", difficulty: "medium", text: "What's your most embarrassing Discord moment?" },
  { id: "t_c1", type: "truth", category: "chaos", difficulty: "medium", text: "Who in this server would survive longest in a zombie apocalypse — and why?" },
  { id: "t_c2", type: "truth", category: "chaos", difficulty: "hard", text: "What's the pettiest thing you've done online?" },
  { id: "t_p1", type: "truth", category: "personal", difficulty: "easy", text: "What's a small habit you're weirdly proud of?" },
  { id: "t_p2", type: "truth", category: "personal", difficulty: "medium", text: "What's something you've pretended to understand when you had no idea?" },
  { id: "t_e1", type: "truth", category: "embarrassing", difficulty: "medium", text: "What's a text you wish you could unsend?" },
  { id: "t_e2", type: "truth", category: "embarrassing", difficulty: "hard", text: "What's the cringiest username you've ever had?" },
  { id: "t_g1", type: "truth", category: "gaming", difficulty: "easy", text: "What's a game you rage-quit the hardest?" },
  { id: "t_g2", type: "truth", category: "gaming", difficulty: "medium", text: "Which Roblox game have you spent way too much time on?" },
  { id: "t_d1", type: "truth", category: "discord", difficulty: "easy", text: "Which server emoji do you overuse?" },
  { id: "t_d2", type: "truth", category: "discord", difficulty: "medium", text: "Who here has the best Discord profile, in your opinion?" },
  { id: "t_r1", type: "truth", category: "relationships", difficulty: "easy", text: "What's your go-to way to make a friend laugh?" },
  { id: "t_r2", type: "truth", category: "relationships", difficulty: "medium", text: "What's a wholesome thing someone in this server did that stuck with you?" },
  { id: "t_x1", type: "truth", category: "extreme", difficulty: "extreme", text: "What's a fear you'd never admit in a voice chat?" },
  { id: "t_x2", type: "truth", category: "extreme", difficulty: "unhinged", text: "What's the most chaotic opinion you actually believe?" },
];

const DARES: TodContentItem[] = [
  { id: "d_f1", type: "dare", category: "funny", difficulty: "easy", text: "Change your nickname to Professional Yapper for 10 minutes." },
  { id: "d_f2", type: "dare", category: "funny", difficulty: "easy", text: "Talk only using emojis in this channel for 5 minutes." },
  { id: "d_c1", type: "dare", category: "chaos", difficulty: "medium", text: "Let another player choose your Discord status for 15 minutes." },
  { id: "d_c2", type: "dare", category: "chaos", difficulty: "hard", text: "Send a message typed entirely with your elbows (or thumbs upside-down)." },
  { id: "d_g1", type: "dare", category: "gaming", difficulty: "easy", text: "Share your most-played Roblox game and why." },
  { id: "d_g2", type: "dare", category: "gaming", difficulty: "medium", text: "Post a screenshot of your current Roblox avatar (or describe it in detail)." },
  { id: "d_d1", type: "dare", category: "discord", difficulty: "easy", text: "React to the last 5 messages in this channel with the same emoji." },
  { id: "d_d2", type: "dare", category: "discord", difficulty: "medium", text: "Compliment three people in this channel (keep it wholesome)." },
  { id: "d_ph1", type: "dare", category: "photo", difficulty: "medium", text: "Take a picture of something red near you.", requiresProof: true },
  { id: "d_ph2", type: "dare", category: "photo", difficulty: "easy", text: "Take a picture of something blue near you.", requiresProof: true },
  { id: "d_v1", type: "dare", category: "voice", difficulty: "medium", text: "Send a 10-second voice message singing any song (badly is fine)." },
  { id: "d_v2", type: "dare", category: "voice", difficulty: "hard", text: "Send a voice message reading a tongue twister." },
  { id: "d_irl1", type: "dare", category: "irl", difficulty: "easy", text: "Take a picture of the sky.", requiresProof: true },
  { id: "d_irl2", type: "dare", category: "irl", difficulty: "medium", text: "Make yourself a drink and show it.", requiresProof: true },
  { id: "d_irl3", type: "dare", category: "irl", difficulty: "hard", text: "Go outside (safely) and take a picture of something interesting.", requiresProof: true },
  { id: "d_x1", type: "dare", category: "extreme", difficulty: "extreme", text: "Let the chat invent a silly nickname and wear it for 30 minutes." },
  { id: "d_u1", type: "dare", category: "unhinged", difficulty: "unhinged", text: "Write a 3-sentence dramatic trailer about someone in this server (keep it kind)." },
];

export const BUILTIN_TOD_CONTENT: TodContentItem[] = [...TRUTHS, ...DARES];

export function pickContent(opts: {
  type?: TodContentType;
  category?: string;
  difficulty?: TodDifficulty;
  pool?: TodContentItem[];
}): TodContentItem | null {
  let pool = (opts.pool ?? BUILTIN_TOD_CONTENT).filter((c) => c.enabled !== false);
  if (opts.type) pool = pool.filter((c) => c.type === opts.type);
  if (opts.category && opts.category !== "random") {
    pool = pool.filter((c) => c.category === opts.category);
  }
  if (opts.difficulty) pool = pool.filter((c) => c.difficulty === opts.difficulty);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export function rewardFor(item: TodContentItem): number {
  const table = DIFFICULTY_REWARDS[item.difficulty];
  return item.type === "truth" ? table.truth : table.dare;
}

export const SPIN_OUTCOMES = [
  { key: "truth", label: "Truth", emoji: "🟢", weight: 28 },
  { key: "dare", label: "Dare", emoji: "🔴", weight: 28 },
  { key: "double_dare", label: "Double Dare", emoji: "🟣", weight: 12 },
  { key: "pick_someone", label: "Pick Someone", emoji: "🟡", weight: 12 },
  { key: "extreme", label: "Extreme Dare", emoji: "💀", weight: 10 },
  { key: "jackpot", label: "Jackpot", emoji: "💰", weight: 5 },
  { key: "mystery", label: "Mystery", emoji: "👻", weight: 5 },
] as const;

export type SpinKey = (typeof SPIN_OUTCOMES)[number]["key"];

export function spinWheel(): (typeof SPIN_OUTCOMES)[number] {
  const total = SPIN_OUTCOMES.reduce((s, o) => s + o.weight, 0);
  let roll = Math.random() * total;
  for (const o of SPIN_OUTCOMES) {
    roll -= o.weight;
    if (roll <= 0) return o;
  }
  return SPIN_OUTCOMES[0]!;
}

export const TOD_TITLES: Record<string, { label: string; minCompleted: number }> = {
  truth_seeker: { label: "Truth Seeker", minCompleted: 5 },
  dare_devil: { label: "Dare Devil", minCompleted: 10 },
  chaos_agent: { label: "Chaos Agent", minCompleted: 20 },
  professional_yapper: { label: "Professional Yapper", minCompleted: 30 },
  risk_taker: { label: "Risk Taker", minCompleted: 40 },
  unhinged: { label: "Unhinged", minCompleted: 50 },
  truth_master: { label: "Truth Master", minCompleted: 25 },
  dare_master: { label: "Dare Master", minCompleted: 25 },
  challenge_king: { label: "Challenge King", minCompleted: 60 },
  challenge_queen: { label: "Challenge Queen", minCompleted: 60 },
  fearless: { label: "Fearless", minCompleted: 100 },
};

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100] as const;
