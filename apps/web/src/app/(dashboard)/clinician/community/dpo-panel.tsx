"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/components/community/staff-format";
import { StaffMessage, useStaffAction } from "@/components/community/use-staff-action";
import type { StaffActionResult } from "@/components/community/staff-types";
import type { DpoCandidate, DpoList } from "@/components/community/unmask-shared";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", clinician: "Doctor", care_coordinator: "Care coordinator" };

/**
 * Optional extra people who are told when a member's name is looked up. The Chief Medical Officer is always told and is the data protection
 * officer for now, so this list can stay empty. Nothing about switching Community on depends on it.
 */
export function DpoRecipientsPanel({
  recipients,
  candidates,
  onSet,
}: {
  recipients: DpoList["dpo"];
  candidates: DpoCandidate[];
  onSet: (input: { profileId: string; on: boolean }) => Promise<StaffActionResult>;
}) {
  const uid = useId();
  const { message, pending, run } = useStaffAction();
  const [choice, setChoice] = useState("");
  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <h2 id={`${uid}-h`} className="font-heading text-lg font-semibold text-charcoal-ink">
        Who is told about member lookups
      </h2>
      <p className="max-w-3xl text-sm text-charcoal-ink/70">
        You are told every time a member&apos;s name is looked up, and you act as the data protection officer for now. You can also tell one or two other
        staff members. The notice carries no name and no content. This is optional and does not hold anything up.
      </p>
      <StaffMessage message={message} />
      {recipients.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">No one else is told. Only you.</p>
      ) : (
        <ul className="space-y-2">
          {recipients.map((r) => (
            <li key={r.profile_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 p-3 text-sm">
              <span>
                {r.name ?? "Unnamed staff member"} <span className="text-charcoal-ink/60">(added {formatDay(r.set_at)})</span>
              </span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => onSet({ profileId: r.profile_id, on: false }))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`${uid}-pick`} className="block text-sm font-medium text-charcoal-ink">
            Add someone
          </label>
          <select
            id={`${uid}-pick`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="mt-1 h-10 min-w-64 rounded-md border border-charcoal-ink/20 bg-white px-3 text-sm"
          >
            <option value="">Choose a staff member</option>
            {candidates.map((c) => (
              <option key={c.profile_id} value={c.profile_id}>
                {c.name} ({ROLE_LABEL[c.role] ?? "Staff"})
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          disabled={pending || choice === ""}
          onClick={() => run(() => onSet({ profileId: choice, on: true }), (r) => r.ok && setChoice(""))}
        >
          Add
        </Button>
      </div>
    </section>
  );
}
