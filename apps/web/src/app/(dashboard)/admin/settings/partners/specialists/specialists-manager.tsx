"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CommissionRateEditor } from "@/components/admin/commission-rate-editor";
import { PartnerLicenseBadge, PartnerLicenseEditor } from "@/components/admin/partner-license-fields";
import {
  useAllSpecialistProviders,
  useCreateSpecialistProvider,
  useSetSpecialistProviderActive,
  useUpdateSpecialistProviderCommission,
  useUpdateSpecialistProviderLicense,
  type SpecialistType,
} from "@/lib/queries/partner-catalogues";

const SPECIALIST_TYPES: SpecialistType[] = [
  "urologist",
  "oncologist",
  "ob_gyn",
  "cardiology",
  "endocrinology",
  "nephrology",
  "ophthalmology",
  "dietetics",
  "podiatry",
  "other",
];

export function SpecialistsManager() {
  const { data: specialists, isLoading } = useAllSpecialistProviders();
  const create = useCreateSpecialistProvider();
  const toggle = useSetSpecialistProviderActive();
  const updateCommission = useUpdateSpecialistProviderCommission();
  const updateLicense = useUpdateSpecialistProviderLicense();
  const [savingCommissionId, setSavingCommissionId] = useState<string | null>(null);
  const [commissionErrorId, setCommissionErrorId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [specialistType, setSpecialistType] = useState<SpecialistType>("cardiology");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [feeNaira, setFeeNaira] = useState("");
  const [telemedicine, setTelemedicine] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [commissionPercent, setCommissionPercent] = useState("15");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a specialist</CardTitle>
          <CardDescription>Referral targets patients can be matched to.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const naira = Number(feeNaira || "0");
              create.mutate(
                {
                  name,
                  specialistType,
                  state: state || null,
                  city: city || null,
                  contactEmail: contactEmail || null,
                  contactPhone: contactPhone || null,
                  consultationFeeKobo: Math.round(naira * 100),
                  supportsTelemedicine: telemedicine,
                  isActive,
                  commissionRateType: "percentage",
                  commissionRate: Number(commissionPercent || "0") / 100,
                  commissionFlatKobo: null,
                },
                {
                  onSuccess: () => {
                    setName("");
                    setState("");
                    setCity("");
                    setContactEmail("");
                    setContactPhone("");
                    setFeeNaira("");
                    setTelemedicine(false);
                    setIsActive(true);
                    setCommissionPercent("15");
                  },
                  onError: (err) => setError(err instanceof Error ? err.message : "Could not save"),
                }
              );
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="sp-name">Name</Label>
              <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-type">Specialty</Label>
              <Select id="sp-type" value={specialistType} onChange={(e) => setSpecialistType(e.target.value as SpecialistType)}>
                {SPECIALIST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-state">State</Label>
              <Input id="sp-state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-city">City</Label>
              <Input id="sp-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-contact-email">Contact email</Label>
              <Input
                id="sp-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
              <p className="text-xs text-charcoal-ink/50">
                Where a booking confirmation is sent once a referral is assigned to them.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-contact-phone">Contact phone</Label>
              <Input
                id="sp-contact-phone"
                placeholder="+234XXXXXXXXXX"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-fee">Consultation fee (₦)</Label>
              <Input id="sp-fee" type="number" min="0" value={feeNaira} onChange={(e) => setFeeNaira(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-commission">Commission (%)</Label>
              <Input
                id="sp-commission"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
              />
              <p className="text-xs text-charcoal-ink/50">
                Flat-fee commissions and rate changes for existing specialists can be set below.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={telemedicine} onChange={(e) => setTelemedicine(e.target.checked)} />
              Supports telemedicine
            </label>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
            {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Add specialist"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specialists</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/60">Loading…</p>
          ) : (specialists ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No specialists yet.</p>
          ) : (
            (specialists ?? []).map((sp) => (
              <div key={sp.id} className="space-y-2 rounded-md border border-charcoal-ink/10 px-4 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-charcoal-ink">{sp.name}</span>
                    <Badge variant="grey">{sp.specialist_type.replace(/_/g, " ")}</Badge>
                    <Badge variant={sp.is_active ? "green" : "grey"}>{sp.is_active ? "Active" : "Inactive"}</Badge>
                    {sp.supports_telemedicine && <Badge variant="blue">Telemedicine</Badge>}
                    <PartnerLicenseBadge expiresAt={sp.license_expires_at} />
                    {(sp.city || sp.state) && (
                      <span className="text-xs text-charcoal-ink/50">
                        {[sp.city, sp.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {!sp.contact_email && !sp.contact_phone && (
                      <span className="text-xs text-amber-700">No contact details on file</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: sp.id, isActive: !sp.is_active })}
                  >
                    {sp.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
                {sp.license_number && (
                  <p className="text-xs text-charcoal-ink/50">
                    {sp.license_type ?? "License"}: {sp.license_number}
                  </p>
                )}
                <PartnerLicenseEditor
                  values={sp}
                  saving={updateLicense.isPending}
                  onSave={(next) => updateLicense.mutate({ id: sp.id, ...next })}
                />
                <CommissionRateEditor
                  idPrefix={`specialist-${sp.id}`}
                  value={{
                    commissionRateType: sp.commission_rate_type,
                    commissionRate: sp.commission_rate,
                    commissionFlatKobo: sp.commission_flat_kobo,
                  }}
                  isSaving={updateCommission.isPending && savingCommissionId === sp.id}
                  error={commissionErrorId === sp.id ? (updateCommission.error as Error)?.message : null}
                  onSave={(value) => {
                    setSavingCommissionId(sp.id);
                    setCommissionErrorId(null);
                    updateCommission.mutate(
                      { id: sp.id, ...value },
                      { onError: () => setCommissionErrorId(sp.id), onSettled: () => setSavingCommissionId(null) }
                    );
                  }}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
