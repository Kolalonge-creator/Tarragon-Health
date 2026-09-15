"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SpecialistProviderTier } from "@tarragon/shared";

const PROVIDER_TIERS: { value: SpecialistProviderTier; label: string }[] = [
  { value: "primary_care", label: "Primary care" },
  { value: "specialist", label: "Specialist" },
  { value: "subspecialist", label: "Subspecialist" },
  { value: "allied_professional", label: "Allied professional" },
];

export type SpecialistProfileValues = {
  subspecialty: string | null;
  qualifications: string[];
  years_of_experience: number | null;
  clinical_interests: string[];
  provider_tier: SpecialistProviderTier | null;
};

/**
 * 66.2 profile fields this table never carried before this pass:
 * subspecialty, qualifications, years of experience, clinical interests, and
 * a descriptive provider tier (never inferred/defaulted — an admin must
 * choose "Not set" explicitly rather than the app guessing one, same
 * principle CLAUDE.md states for clinical_staff.doctor_tier).
 */
export function SpecialistProfileEditor({
  values,
  onSave,
  saving,
}: {
  values: SpecialistProfileValues;
  onSave: (next: SpecialistProfileValues) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [subspecialty, setSubspecialty] = useState(values.subspecialty ?? "");
  const [qualifications, setQualifications] = useState(values.qualifications.join(", "));
  const [yearsOfExperience, setYearsOfExperience] = useState(
    values.years_of_experience != null ? String(values.years_of_experience) : ""
  );
  const [clinicalInterests, setClinicalInterests] = useState(values.clinical_interests.join(", "));
  const [providerTier, setProviderTier] = useState<SpecialistProviderTier | "">(values.provider_tier ?? "");

  if (!open) {
    return (
      <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen(true)}>
        Edit profile
      </button>
    );
  }

  return (
    <div className="mt-2 grid gap-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label>Subspecialty</Label>
        <Input
          placeholder="e.g. Interventional cardiology"
          value={subspecialty}
          onChange={(e) => setSubspecialty(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label>Years of experience</Label>
        <Input
          type="number"
          min="0"
          max="80"
          value={yearsOfExperience}
          onChange={(e) => setYearsOfExperience(e.target.value)}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>Qualifications (comma-separated)</Label>
        <Input
          placeholder="e.g. MBBS, FWACS, MSc Cardiology"
          value={qualifications}
          onChange={(e) => setQualifications(e.target.value)}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>Clinical interests (comma-separated)</Label>
        <Input
          placeholder="e.g. heart failure, interventional cardiology"
          value={clinicalInterests}
          onChange={(e) => setClinicalInterests(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label>Provider tier</Label>
        <Select value={providerTier} onChange={(e) => setProviderTier(e.target.value as SpecialistProviderTier | "")}>
          <option value="">Not set</option>
          {PROVIDER_TIERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-end gap-2 sm:col-span-2">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => {
            onSave({
              subspecialty: subspecialty.trim() || null,
              qualifications: qualifications
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              years_of_experience: yearsOfExperience ? Number(yearsOfExperience) : null,
              clinical_interests: clinicalInterests
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              provider_tier: providerTier || null,
            });
            setOpen(false);
          }}
        >
          {saving ? "Saving…" : "Save profile"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
