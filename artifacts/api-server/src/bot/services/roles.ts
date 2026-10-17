import type { Guild } from "discord.js";
import type { MemberIdentity } from "./config";
import { identityFromUser } from "./config";

/**
 * Resolve every human member of a role to a MemberIdentity — the unit all
 * bulk XP operations work on.
 *
 * Uses the role's cached members only. Do **not** call `guild.members.fetch()`
 * with no filter: GuildMemberManager is cache-capped (maxSize 200), so a full
 * guild chunk hangs on large servers and still only keeps 200 people.
 */
export async function roleMemberIdentities(
  guild: Guild,
  roleId: string
): Promise<MemberIdentity[]> {
  const role = guild.roles.cache.get(roleId);
  if (!role) return [];
  return [...role.members.values()]
    .filter((m) => !m.user.bot)
    .map((m) => identityFromUser(m.user, m.displayName));
}

/**
 * User ids of members holding ANY of the given roles (from cache).
 * Never triggers a full guild member fetch — that hangs on large clans.
 */
export async function memberIdsWithRoles(
  guild: Guild,
  roleIds: string[]
): Promise<string[]> {
  if (!roleIds.length) return [];
  const ids = new Set<string>();
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    for (const m of role.members.values()) {
      if (!m.user.bot) ids.add(m.id);
    }
  }
  return [...ids];
}
