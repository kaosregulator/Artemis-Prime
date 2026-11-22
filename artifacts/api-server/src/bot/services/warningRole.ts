/**
 * The configured warning role turns on at this many active warnings and
 * comes off again when the member drops below it. Warning records are never
 * expired by the bot — staff clear them, usually after a dispute ticket.
 */
export const WARNING_ROLE_ACTIVE_COUNT = 2;

/** Cooldown presets offered in /setup (days; 0 = off). */
export const ROLE_COOLDOWN_PRESETS = [0, 7, 14, 30] as const;

const DAY_MS = 86_400_000;

export interface WarningRoleInput {
  activeCount: number;
  /** When the member's newest *active* warning was issued. */
  newestActiveAt?: Date | null;
  /** clans.warningRoleCooldownDays — 0 / undefined means no cooldown. */
  cooldownDays?: number | null;
  now?: Date;
}

/**
 * Should the member hold the warning role right now?
 *  - Needs {@link WARNING_ROLE_ACTIVE_COUNT}+ active warnings.
 *  - With a cooldown, the role also needs a warning newer than the cooldown:
 *    a clean stretch takes the role off, and any new warning restarts it.
 */
export function shouldHoldWarningRole(input: WarningRoleInput | number): boolean {
  const opts = typeof input === "number" ? { activeCount: input } : input;
  if (opts.activeCount < WARNING_ROLE_ACTIVE_COUNT) return false;
  const days = opts.cooldownDays ?? 0;
  if (days <= 0 || !opts.newestActiveAt) return true;
  const now = (opts.now ?? new Date()).getTime();
  return now - opts.newestActiveAt.getTime() < days * DAY_MS;
}

/** Human label used in /setup and staff logs. */
export function roleCooldownLabel(days: number | null | undefined): string {
  if (!days || days <= 0) return "off — the role stays until warnings are cleared";
  return `${days} day${days === 1 ? "" : "s"} without a new warning`;
}
