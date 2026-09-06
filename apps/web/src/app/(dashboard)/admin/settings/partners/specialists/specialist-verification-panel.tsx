"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  SPECIALIST_VERIFICATION_STAGES,
  useAdvanceSpecialistVerificationStage,
  useSpecialistProviderVerificationEvents,
} from "@/lib/queries/specialist-provider-network";
import type { SpecialistVerificationStage } from "@tarragon/shared";

const STAGE_LABELS: Record<SpecialistVerificationStage, string> = {
  application: "Application",
  identity_verification: "Identity verification",
  registration_verification: "Professional registration verification",
  qualification_verification: "Qualification verification",
  specialty_verification: "Specialty verification",
  contract: "Contract",
  onboarding: "Onboarding",
  clinical_approval: "Clinical approval",
  active: "Active",
};

const STAGE_BADGE: Record<SpecialistVerificationStage, "grey" | "amber" | "blue" | "green"> = {
  application: "grey",
  identity_verification: "amber",
  registration_verification: "amber",
  qualification_verification: "amber",
  specialty_verification: "amber",
  contract: "blue",
  onboarding: "blue",
  clinical_approval: "blue",
  active: "green",
};

/**
 * 66.3 verification pipeline: Application -> Identity verification ->
 * Professional registration verification -> Qualification verification ->
 * Specialty verification -> Contract -> Onboarding -> Clinical approval ->
 * Active. Every transition goes through advance_specialist_verification_stage
 * (never a bare column update), so it's always attributed + audited — this
 * panel is a thin UI over that RPC plus its event log. Any stage other than
 * "active" also requires is_active to be off (DB-enforced), so getting a
 * specialist fully live is still two steps: reach "Active" here, then flip
 * the existing Activate toggle above.
 */
export function SpecialistVerificationPanel({
  specialistProviderId,
  currentStage,
}: {
  specialistProviderId: string;
  currentStage: SpecialistVerificationStage;
}) {
  const [open, setOpen] = useState(false);
  const [toStage, setToStage] = useState<SpecialistVerificationStage>(currentStage);
  const [note, setNote] = useState("");
  const advance = useAdvanceSpecialistVerificationStage();
  const { data: events } = useSpecialistProviderVerificationEvents(open ? specialistProviderId : "");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STAGE_BADGE[currentStage]}>Verification: {STAGE_LABELS[currentStage]}</Badge>
        <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide verification pipeline" : "Manage verification"}
        </button>
      </div>
      {open && (
        <div className="space-y-3 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-charcoal-ink/60">Move to stage</label>
              <Select
                className="h-9 w-64"
                value={toStage}
                onChange={(e) => setToStage(e.target.value as SpecialistVerificationStage)}
              >
                {SPECIALIST_VERIFICATION_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-charcoal-ink/60">Note (optional)</label>
              <Input className="h-9 w-64" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={advance.isPending || toStage === currentStage}
              onClick={() =>
                advance.mutate(
                  { id: specialistProviderId, toStage, note: note.trim() || undefined },
                  { onSuccess: () => setNote("") }
                )
              }
            >
              {advance.isPending ? "Saving…" : "Advance"}
            </Button>
          </div>
          {advance.isError && <p className="text-xs text-red-600">Could not save. Try again.</p>}
          {toStage !== "active" && toStage !== currentStage && (
            <p className="text-xs text-charcoal-ink/50">
              Moving away from &quot;Active&quot; also turns this specialist off in the catalogue until it
              reaches Active again.
            </p>
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium text-charcoal-ink/70">History</p>
            {(events ?? []).length === 0 ? (
              <p className="text-xs text-charcoal-ink/50">No transitions recorded yet.</p>
            ) : (
              <ul className="space-y-1">
                {(events ?? []).map((event) => (
                  <li key={event.id} className="text-xs text-charcoal-ink/60">
                    {new Date(event.created_at).toLocaleDateString()}:{" "}
                    {event.from_stage ? STAGE_LABELS[event.from_stage] : "—"} → {STAGE_LABELS[event.to_stage]}
                    {event.note ? ` (${event.note})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
