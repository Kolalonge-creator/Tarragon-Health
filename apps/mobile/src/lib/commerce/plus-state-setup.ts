import type { MessageKey } from "@tarragon/i18n";
import type { MembershipState } from "./parse";

/**
 * The card that lets a Membership Plus member with no collection state (employer seat, earlier grant) choose one once (OQ-PLUS-1).
 * Pure so the rules are tested without rendering a screen.
 */
export function needsPlusStateSetup(input: { ladder: boolean; forSomeoneElse: boolean; tier: string | null; membership: MembershipState }): boolean {
  return input.ladder && !input.forSomeoneElse && input.tier === "plus" && input.membership.isMember && !input.membership.collectionState;
}

/** The sentence for a refused save. The database codes are never shown. */
export function plusStateSetupErrorKey(message: string): MessageKey {
  if (message.includes("plus_state_not_available")) return "shop.error.plus_state_not_available";
  if (message.includes("plus_state_already_set")) return "shop.plus.state.already_set";
  return "shop.plus.state.set_error";
}
