"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyPlanMembers } from "@/lib/queries/family-plan-members";
import { VaccinationRegistry } from "../vaccination-registry";
import { LogVaccinationForm } from "../log-vaccination-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";
import { ageFromDateOfBirth } from "@tarragon/shared";

/**
 * The family immunization card — a child's NPHCDA vaccine schedule, kept by
 * the parent, doctor-verifiable via the existing certificate pathway, never
 * lost like the paper card. Reads the member's DOB/sex via profiles RLS
 * (profile_access grantees included) and reuses the standard registry/log
 * components pointed at the member — record writes are allowed for
 * profile_access 'manage' grantees (migration 20260723200847). This is the
 * family's own verified record, not a government/EMID registry.
 */
export function ChildVaccinesCard() {
  const { data: members } = useFamilyPlanMembers();
  const [selected, setSelected] = useState<string>("");

  const { data: memberProfile } = useQuery({
    queryKey: ["family-member-profile", selected],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, date_of_birth, sex")
        .eq("id", selected)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!selected,
  });

  if (!members || members.length === 0) return null;

  // Children first, but any family member can be viewed — a parent's own
  // vaccines matter too.
  const ordered = [...members].sort((a, b) =>
    a.relationship === "child" ? -1 : b.relationship === "child" ? 1 : 0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.vaccination className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Family immunization cards
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          Every child&apos;s routine vaccines (the national NPHCDA schedule — BCG, polio,
          pentavalent, measles and more), tracked from birth, with reminders when a dose is
          coming up. Doctor-verified doses earn a Tarragon certificate — a record that
          can&apos;t get lost the way a paper card can.
        </p>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Family member"
          className="rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
        >
          <option value="">Choose a family member…</option>
          {ordered.map((m) => (
            <option key={m.id} value={m.member_id}>
              {m.member?.full_name ?? "Family member"} ({m.relationship})
            </option>
          ))}
        </select>

        {selected && !memberProfile && (
          <p className="text-sm text-charcoal-ink/60">
            You can&apos;t view this member&apos;s record yet — they need to share access with
            you from their own account (Profile → shared access).
          </p>
        )}

        {memberProfile && (
          <div className="space-y-4 border-t border-charcoal-ink/10 pt-4">
            <VaccinationRegistry
              patientId={memberProfile.id}
              ageYears={ageFromDateOfBirth(memberProfile.date_of_birth)}
              dateOfBirth={memberProfile.date_of_birth}
              sex={memberProfile.sex}
            />
            <LogVaccinationForm patientId={memberProfile.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
