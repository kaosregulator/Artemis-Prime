/** Who /warnboard is allowed to list. Past role holders stay off it. */
export function warnBoardAudience(input: {
  requiredRoleId: string | null;
  roleOnServer: boolean;
  memberIds: string[];
}): { ok: true; memberIds: string[] } | { ok: false; message: string } {
  if (!input.requiredRoleId) {
    return {
      ok: false,
      message:
        "Set the activity track role in /setup. This board only lists people who have that role right now.",
    };
  }
  if (!input.roleOnServer) {
    return {
      ok: false,
      message: "The activity track role isn't on this server. Set it again in /setup.",
    };
  }
  return { ok: true, memberIds: input.memberIds };
}
