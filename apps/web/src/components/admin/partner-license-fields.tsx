"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared across lab_providers/pharmacy_partners/specialist_providers/
 * home_visit_providers/logistics_partners — a partner catalogue row can be
 * activated with no record of the underlying regulatory registration behind
 * it (PCN premises registration, NAFDAC/state facility license, MDCN
 * registration, CAC business registration). This never blocks activation —
 * that's a separate, bigger product decision — it makes the registration
 * visible and gives the nightly partner-license-expiry-alerts-daily cron
 * something to check.
 */
export type PartnerLicenseValues = {
  license_type: string | null;
  license_number: string | null;
  license_expires_at: string | null;
};

export function licenseStatus(expiresAt: string | null): {
  label: string;
  variant: "green" | "amber" | "red" | "grey";
} {
  if (!expiresAt) return { label: "Not on file", variant: "grey" };
  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  if (expiry <= now) return { label: "Expired", variant: "red" };
  if (expiry - now < 30 * 24 * 60 * 60 * 1000) return { label: "Expires soon", variant: "amber" };
  return { label: "Current", variant: "green" };
}

export function PartnerLicenseBadge({ expiresAt }: { expiresAt: string | null }) {
  const status = licenseStatus(expiresAt);
  return <Badge variant={status.variant}>License: {status.label}</Badge>;
}

export function PartnerLicenseEditor({
  values,
  onSave,
  saving,
}: {
  values: PartnerLicenseValues;
  onSave: (next: PartnerLicenseValues) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [licenseType, setLicenseType] = useState(values.license_type ?? "");
  const [licenseNumber, setLicenseNumber] = useState(values.license_number ?? "");
  const [licenseExpiresAt, setLicenseExpiresAt] = useState(
    values.license_expires_at ? values.license_expires_at.slice(0, 10) : ""
  );

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-charcoal-ink/60 underline"
        onClick={() => setOpen(true)}
      >
        Edit regulatory license
      </button>
    );
  }

  return (
    <div className="mt-2 grid gap-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label>License type</Label>
        <Input
          placeholder="e.g. PCN premises registration"
          value={licenseType}
          onChange={(e) => setLicenseType(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label>License / registration number</Label>
        <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Expires</Label>
        <Input type="date" value={licenseExpiresAt} onChange={(e) => setLicenseExpiresAt(e.target.value)} />
      </div>
      <div className="flex items-end gap-2 sm:col-span-3">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => {
            onSave({
              license_type: licenseType.trim() || null,
              license_number: licenseNumber.trim() || null,
              license_expires_at: licenseExpiresAt ? new Date(licenseExpiresAt).toISOString() : null,
            });
            setOpen(false);
          }}
        >
          {saving ? "Saving…" : "Save license"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
