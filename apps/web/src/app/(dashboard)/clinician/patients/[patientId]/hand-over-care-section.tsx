"use client";

import { useState } from "react";
import { useOrgClinicians, useOrgCareCoordinators } from "@/lib/queries/clinical-staff";
import { useCareTeamHandovers, useHandOverCare } from "@/lib/queries/care-team-handover";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const ROLE_LABEL: Record<string, string> = {
  clinician: "Doctor",
  care_coordinator: "Care coordinator",
};

/**
 * Care Team / Provider Workspace §5.15 — an explicit, note-carrying handover
 * distinct from CareTeamForm's plain reassignment above: this is for "I'm
 * handing this patient off, here's why", not the initial team setup. Every
 * reassignment (through here or through CareTeamForm) shows up in the
 * history below — hand_over_care just attaches a reason to this one.
 */
export function HandOverCareSection({ patientId }: { patientId: string }) {
  const { data: clinicians } = useOrgClinicians();
  const { data: coordinators } = useOrgCareCoordinators();
  const { data: history } = useCareTeamHandovers(patientId);
  const handOver = useHandOverCare();

  const [role, setRole] = useState<"clinician" | "care_coordinator">("clinician");
  const [newProfileId, setNewProfileId] = useState("");
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState(false);

  const assignableClinicians = (clinicians ?? []).filter((c) => c.profile_id !== null);
  const options =
    role === "clinician"
      ? assignableClinicians.map((c) => ({ id: c.profile_id!, label: c.full_name ?? "Doctor" }))
      : (coordinators ?? []).map((c) => ({ id: c.id, label: c.full_name ?? "Coordinator" }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hand over care</CardTitle>
        <CardDescription>Reassign the doctor or care coordinator for this patient, with a reason.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="handover_role">Role</Label>
            <Select
              id="handover_role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as "clinician" | "care_coordinator");
                setNewProfileId("");
              }}
            >
              <option value="clinician">Doctor</option>
              <option value="care_coordinator">Care coordinator</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover_to">Hand over to</Label>
            <Select
              id="handover_to"
              value={newProfileId}
              onChange={(event) => setNewProfileId(event.target.value)}
            >
              <option value="">Select…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="handover_note">Reason (required)</Label>
          <Textarea
            id="handover_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Going on leave for two weeks, handing off to cover"
            rows={2}
          />
        </div>
        {handOver.isError && <p className="text-sm text-red-600">Could not hand over care. Try again.</p>}
        {success && <p className="text-sm text-brand-green">Handed over.</p>}
        <Button
          disabled={!newProfileId || note.trim().length === 0 || handOver.isPending}
          onClick={() => {
            setSuccess(false);
            handOver.mutate(
              { patientId, role, newProfileId, note: note.trim() },
              {
                onSuccess: () => {
                  setSuccess(true);
                  setNewProfileId("");
                  setNote("");
                },
              },
            );
          }}
        >
          {handOver.isPending ? "Saving…" : "Hand over"}
        </Button>

        {history && history.length > 0 && (
          <div className="space-y-1.5 border-t border-charcoal-ink/10 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">History</p>
            <ul className="space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="text-xs text-charcoal-ink/70">
                  {ROLE_LABEL[h.role] ?? h.role}: {h.from_profile?.full_name ?? "Unassigned"} →{" "}
                  {h.to_profile?.full_name ?? "Unassigned"} ·{" "}
                  {new Date(h.created_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {h.note && <span className="block text-charcoal-ink/50">&quot;{h.note}&quot;</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
