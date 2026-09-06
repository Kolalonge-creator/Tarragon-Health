"use client";

import { useState, type FormEvent } from "react";
import {
  useProviderRestrictions,
  useImposeProviderRestriction,
  useLiftProviderRestriction,
  type ProviderRestriction,
  type ProviderRestrictionStage,
  type ProviderRestrictionReason,
} from "@/lib/queries/provider-restrictions";
import { useAllClinicalStaff } from "@/lib/queries/clinical-staff";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STAGES: ProviderRestrictionStage[] = ["warning", "grace_period", "service_restriction", "suspension"];
const REASONS: ProviderRestrictionReason[] = [
  "license_expiry",
  "indemnity_expiry",
  "attestation_lapse",
  "complaint_outcome",
  "performance",
  "governance_directive",
];

const STAGE_BADGE: Record<ProviderRestrictionStage, "grey" | "amber" | "red"> = {
  warning: "grey",
  grace_period: "amber",
  service_restriction: "amber",
  suspension: "red",
};

const STAGE_LABEL: Record<ProviderRestrictionStage, string> = {
  warning: "Warning",
  grace_period: "Grace period",
  service_restriction: "Service restricted",
  suspension: "Suspended",
};

const REASON_LABEL: Record<ProviderRestrictionReason, string> = {
  license_expiry: "License expiry",
  indemnity_expiry: "Indemnity expiry",
  attestation_lapse: "Attestation lapse",
  complaint_outcome: "Complaint outcome",
  performance: "Performance",
  governance_directive: "Governance directive",
};

function RestrictionRow({ restriction }: { restriction: ProviderRestriction }) {
  const liftRestriction = useLiftProviderRestriction();
  const [showLiftForm, setShowLiftForm] = useState(false);
  const [liftReason, setLiftReason] = useState("");
  const active = restriction.lifted_at === null;

  return (
    <li className="space-y-2 border-b border-charcoal-ink/10 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-charcoal-ink">
              {restriction.clinical_staff?.full_name ?? "Unknown clinician"}
            </p>
            <Badge variant={active ? STAGE_BADGE[restriction.stage] : "grey"}>
              {active ? STAGE_LABEL[restriction.stage] : "Lifted"}
            </Badge>
          </div>
          <p className="text-xs text-charcoal-ink/60">
            {REASON_LABEL[restriction.reason]}
            {restriction.detail && `: ${restriction.detail}`}
            {" · imposed "}
            {new Date(restriction.imposed_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}
          </p>
          {!active && restriction.lift_reason && (
            <p className="text-xs text-charcoal-ink/50">
              Lifted {new Date(restriction.lifted_at as string).toLocaleDateString("en-GB", { dateStyle: "medium" })}:{" "}
              {restriction.lift_reason}
            </p>
          )}
        </div>
        {active && (
          <Button size="sm" variant="outline" onClick={() => setShowLiftForm((v) => !v)}>
            {showLiftForm ? "Cancel" : "Lift"}
          </Button>
        )}
      </div>
      {showLiftForm && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`lift_reason_${restriction.id}`} className="text-xs">
              Reason for lifting (required)
            </Label>
            <Input
              id={`lift_reason_${restriction.id}`}
              value={liftReason}
              onChange={(e) => setLiftReason(e.target.value)}
              placeholder="e.g. License renewed, verified 2026-08-30"
            />
          </div>
          <Button
            size="sm"
            disabled={!liftReason.trim() || liftRestriction.isPending}
            onClick={() =>
              liftRestriction.mutate(
                { id: restriction.id, reason: liftReason.trim() },
                { onSuccess: () => { setShowLiftForm(false); setLiftReason(""); } }
              )
            }
          >
            {liftRestriction.isPending ? "Lifting…" : "Confirm lift"}
          </Button>
        </div>
      )}
      {liftRestriction.isError && (
        <p className="text-xs text-red-600">{(liftRestriction.error as Error).message}</p>
      )}
    </li>
  );
}

function ImposeForm() {
  const { data: staff } = useAllClinicalStaff();
  const impose = useImposeProviderRestriction();
  const [clinicalStaffId, setClinicalStaffId] = useState("");
  const [stage, setStage] = useState<ProviderRestrictionStage>("warning");
  const [reason, setReason] = useState<ProviderRestrictionReason>("performance");
  const [detail, setDetail] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clinicalStaffId) return;
    impose.mutate(
      { clinical_staff_id: clinicalStaffId, stage, reason, detail: detail || undefined },
      { onSuccess: () => { setClinicalStaffId(""); setDetail(""); } }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-md bg-charcoal-ink/5 p-3">
      <div className="space-y-1">
        <Label htmlFor="restrict_staff" className="text-xs">Clinician</Label>
        <Select
          id="restrict_staff"
          value={clinicalStaffId}
          onChange={(e) => setClinicalStaffId(e.target.value)}
          className="h-9 w-56 text-sm"
          required
        >
          <option value="">Select…</option>
          {(staff ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="restrict_stage" className="text-xs">Stage</Label>
        <Select
          id="restrict_stage"
          value={stage}
          onChange={(e) => setStage(e.target.value as ProviderRestrictionStage)}
          className="h-9 w-40 text-sm"
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="restrict_reason" className="text-xs">Reason</Label>
        <Select
          id="restrict_reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as ProviderRestrictionReason)}
          className="h-9 w-44 text-sm"
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="restrict_detail" className="text-xs">Detail (optional)</Label>
        <Input
          id="restrict_detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="w-64"
        />
      </div>
      <Button type="submit" size="sm" disabled={!clinicalStaffId || impose.isPending}>
        {impose.isPending ? "Imposing…" : "Impose restriction"}
      </Button>
      {impose.isError && <p className="w-full text-xs text-red-600">{(impose.error as Error).message}</p>}
    </form>
  );
}

export function ProviderRestrictionsManager() {
  const { data: restrictions, isLoading, isError } = useProviderRestrictions();
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  const filtered = restrictions?.filter((r) => !showActiveOnly || r.lifted_at === null);
  const activeCount = restrictions?.filter((r) => r.lifted_at === null).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Provider restrictions</CardTitle>
            <CardDescription>
              {activeCount} active restriction{activeCount === 1 ? "" : "s"}. Staged: warning → grace
              period → service restriction → suspension, each reason-coded and time-stamped.
              Separate from a clinician&apos;s account active/inactive flag: this is the reason-coded
              history that flag was missing.
            </CardDescription>
          </div>
          <label className="flex items-center gap-2 text-sm text-charcoal-ink/70">
            <input
              type="checkbox"
              checked={showActiveOnly}
              onChange={(e) => setShowActiveOnly(e.target.checked)}
            />
            Active only
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ImposeForm />
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load restrictions.</p>}
        {filtered && filtered.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No restrictions to show.</p>
        )}
        {filtered && filtered.length > 0 && (
          <ul>
            {filtered.map((r) => (
              <RestrictionRow key={r.id} restriction={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
