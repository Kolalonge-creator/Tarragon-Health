"use client";

import { UnmaskPanel } from "@/components/community/unmask-panel";
import type { UnmaskCandidate } from "@/components/community/unmask-shared";
import { unmaskAction } from "./actions";

export { IDENTITY_WARNING } from "@/components/community/unmask-shared";

/** The admin "look up a member" screen: the list of recent safety concerns, and a small fallback by name and group. */
export function UnmaskForm({ groups, candidates }: { groups: Array<{ id: string; name: string }>; candidates: UnmaskCandidate[] | null }) {
  return <UnmaskPanel action={unmaskAction} candidates={candidates} groups={groups} showProfileId />;
}
