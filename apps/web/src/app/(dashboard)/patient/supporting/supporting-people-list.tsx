"use client";

import type { Locale } from "@tarragon/i18n";
import { useSupportedPeople as useSponsoredPeople } from "@/lib/queries/sponsorship";
import { CircleSupporting } from "./circle-supporting";
import { SupportedPeople } from "./supported-people";

/**
 * Everyone who shares their care with this supporter, one card per person. A person who is both in a Care Circle and someone the
 * supporter pays for gets a single card (supported-people.tsx puts the circle half on it), so the Care Circle list leaves them out.
 * Until the paid-for list is known the circle list shows only open requests, never a card that would then jump.
 */
export function SupportingPeopleList({ locale }: { locale: Locale }) {
  const sponsored = useSponsoredPeople();
  const hide = sponsored.isPending ? null : new Set((sponsored.data ?? []).map((p) => p.profileId));
  return (
    <div className="space-y-4">
      <CircleSupporting locale={locale} hidePatientIds={hide} />
      <SupportedPeople locale={locale} />
    </div>
  );
}
