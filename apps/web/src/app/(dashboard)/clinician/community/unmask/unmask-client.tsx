"use client";

import { UnmaskPanel } from "@/components/community/unmask-panel";
import type { UnmaskCandidate } from "@/components/community/unmask-shared";
import { doctorUnmaskAction } from "./actions";

export function DoctorUnmask({ candidates }: { candidates: UnmaskCandidate[] | null }) {
  return <UnmaskPanel action={doctorUnmaskAction} candidates={candidates} showProfileId={false} />;
}
