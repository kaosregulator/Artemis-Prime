/**
 * The configured warning role turns on at this many active warnings and
 * comes off again when the member drops below it. Warnings themselves are
 * not on a timer — staff clear them, usually after a dispute ticket.
 */
export const WARNING_ROLE_ACTIVE_COUNT = 2;

export function shouldHoldWarningRole(activeCount: number): boolean {
  return activeCount >= WARNING_ROLE_ACTIVE_COUNT;
}
