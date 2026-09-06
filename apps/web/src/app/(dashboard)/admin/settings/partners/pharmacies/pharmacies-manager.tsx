"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { CommissionRateEditor } from "@/components/admin/commission-rate-editor";
import { PartnerLicenseBadge, PartnerLicenseEditor } from "@/components/admin/partner-license-fields";
import { SearchableList } from "@/components/ui/searchable-list";
import {
  useAllPharmacyPartners,
  useCreatePharmacyPartner,
  useSetPharmacyPartnerActive,
  useUpdatePharmacyPartnerLicense,
  useAllPharmacyMedications,
  useUpdatePharmacyMedicationCommission,
  useCreatePharmacyMedication,
  useLinkPharmacist,
  useSetPartnerAdmin,
  useAdvancePharmacyPartnerOnboarding,
  useRejectPharmacyPartnerOnboarding,
  useVerifyPharmacyPartnerLocation,
  usePharmacyPartnerLocationsAdmin,
  type PharmacyPartner,
  type PharmacistLoginRow,
} from "@/lib/queries/partner-catalogues";
import { koboToNaira } from "@tarragon/shared";

function parseRegions(raw: string): string[] {
  return raw.split(",").map((r) => r.trim()).filter(Boolean);
}

const ONBOARDING_LABEL: Record<string, string> = {
  application: "Application received",
  business_verification: "Business verification",
  regulatory_verification: "Regulatory/professional verification",
  location_verification: "Location verification",
  service_configuration: "Service configuration",
  integration_testing: "Integration testing",
  approved: "Approved (ready to activate)",
  activated: "Activated",
  rejected: "Rejected",
};

const ONBOARDING_NEXT_LABEL: Record<string, string> = {
  application: "Start business verification",
  business_verification: "Mark business verified → regulatory check",
  regulatory_verification: "Confirm license verified → location check",
  location_verification: "Confirm location verified → service config",
  service_configuration: "Confirm service configured → integration test",
  integration_testing: "Confirm integration tested → approve",
  approved: "Activate",
};

/**
 * Pharmacy Engine spec §12.3 — replaces the flat "just flip is_active"
 * toggle with the real pipeline (docs/PHARMACY_ENGINE_SPEC.md). Only shown
 * for a partner not yet activated/rejected; an activated partner falls back
 * to the plain Deactivate toggle in the parent list, and a rejected one is
 * a dead end (create a fresh application instead of un-rejecting).
 */
function PharmacyOnboardingPanel({ pharmacy }: { pharmacy: PharmacyPartner }) {
  const advance = useAdvancePharmacyPartnerOnboarding();
  const reject = useRejectPharmacyPartnerOnboarding();
  const verifyLocation = useVerifyPharmacyPartnerLocation();
  const { data: locations } = usePharmacyPartnerLocationsAdmin(pharmacy.id);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const status = pharmacy.onboarding_status ?? "application";
  const nextLabel = ONBOARDING_NEXT_LABEL[status];

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="amber">{ONBOARDING_LABEL[status] ?? status}</Badge>
        {status === "regulatory_verification" && !pharmacy.license_verified_at && (
          <span className="text-xs text-amber-800">Needs a verified license (see below) before advancing.</span>
        )}
        {status === "location_verification" && (
          <span className="text-xs text-amber-800">
            {(locations ?? []).some((l) => l.verified_at) ? "Has a verified location." : "Needs a verified location (see below)."}
          </span>
        )}
      </div>

      {status === "location_verification" && (
        <ul className="space-y-1">
          {(locations ?? []).length === 0 && (
            <li className="text-xs text-charcoal-ink/50">
              No branch locations yet. Add one via this pharmacy&apos;s own self-service page first.
            </li>
          )}
          {(locations ?? []).map((loc) => (
            <li key={loc.id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                {loc.name}, {[loc.address, loc.state].filter(Boolean).join(", ")}
                {loc.verified_at && <Badge variant="green" className="ml-1.5">Verified</Badge>}
              </span>
              {!loc.verified_at && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  disabled={verifyLocation.isPending}
                  onClick={() => verifyLocation.mutate(loc.id)}
                >
                  Verify
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {nextLabel && (
          <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate(pharmacy.id)}>
            {advance.isPending ? "Saving…" : nextLabel}
          </Button>
        )}
        {!rejecting ? (
          <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              className="h-8 w-56 text-xs"
              placeholder="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!reason.trim() || reject.isPending}
              onClick={() =>
                reject.mutate(
                  { partnerId: pharmacy.id, reason: reason.trim() },
                  { onSuccess: () => setRejecting(false) }
                )
              }
            >
              Confirm reject
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      {advance.isError && (
        <p className="text-xs text-red-600">{(advance.error as Error).message}</p>
      )}
      {reject.isError && <p className="text-xs text-red-600">{(reject.error as Error).message}</p>}
    </div>
  );
}

/**
 * Adds a drug/SKU to this partner's catalogue — see useCreatePharmacyMedication
 * for why this form didn't exist before (nothing did, anywhere in the app).
 */
function AddPharmacyMedicationForm({ pharmacyId }: { pharmacyId: string }) {
  const create = useCreatePharmacyMedication();
  const [open, setOpen] = useState(false);
  const [drugName, setDrugName] = useState("");
  const [strength, setStrength] = useState("");
  const [packSize, setPackSize] = useState("");
  const [priceNaira, setPriceNaira] = useState("");
  const [isGeneric, setIsGeneric] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        + Add medication
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          {
            pharmacyPartnerId: pharmacyId,
            drugName: drugName.trim(),
            strength: strength.trim(),
            packSize: packSize.trim(),
            priceKobo: Math.round(Number(priceNaira) * 100),
            isGeneric,
          },
          {
            onSuccess: () => {
              setDrugName("");
              setStrength("");
              setPackSize("");
              setPriceNaira("");
              setIsGeneric(false);
              setOpen(false);
            },
          }
        );
      }}
    >
      <div className="w-40 space-y-1">
        <Label className="text-xs">Drug name</Label>
        <Input className="h-8 text-xs" value={drugName} onChange={(e) => setDrugName(e.target.value)} required />
      </div>
      <div className="w-24 space-y-1">
        <Label className="text-xs">Strength</Label>
        <Input className="h-8 text-xs" placeholder="500mg" value={strength} onChange={(e) => setStrength(e.target.value)} />
      </div>
      <div className="w-28 space-y-1">
        <Label className="text-xs">Pack size</Label>
        <Input className="h-8 text-xs" placeholder="30 tablets" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
      </div>
      <div className="w-24 space-y-1">
        <Label className="text-xs">Price (₦)</Label>
        <Input
          className="h-8 text-xs"
          type="number"
          min={0}
          value={priceNaira}
          onChange={(e) => setPriceNaira(e.target.value)}
          required
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-charcoal-ink/80">
        <input type="checkbox" checked={isGeneric} onChange={(e) => setIsGeneric(e.target.checked)} />
        Generic
      </label>
      <Button type="submit" size="sm" disabled={create.isPending}>
        {create.isPending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {create.isError && <p className="w-full text-xs text-red-600">{(create.error as Error).message}</p>}
    </form>
  );
}

function PharmacyCommissionRates() {
  const { data: medications, isLoading } = useAllPharmacyMedications();
  const updateCommission = useUpdatePharmacyMedicationCommission();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pharmacy medications: commission rates</CardTitle>
        <CardDescription>
          This is what actually drives every &quot;pharmacy&quot; commission on the Commissions
          dashboard: computed per medication at order time, not from the pharmacy partner
          itself. Changing a rate here only affects orders placed after the change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {medications && medications.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No pharmacy medications yet.</p>
        )}
        {(medications ?? []).map((med) => (
          <div key={med.id} className="space-y-2 rounded-md border border-charcoal-ink/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-charcoal-ink">
                {med.drug_name}
                {med.pack_size && <span className="text-charcoal-ink/60"> · {med.pack_size}</span>}
              </span>
              <Badge variant={med.is_active ? "green" : "grey"}>{med.is_active ? "Active" : "Inactive"}</Badge>
              {med.pharmacy_partner_name && <Badge variant="blue">{med.pharmacy_partner_name}</Badge>}
              <span className="text-xs text-charcoal-ink/50">
                Price ₦{koboToNaira(med.price_kobo).toLocaleString()}
              </span>
            </div>
            <CommissionRateEditor
              idPrefix={`med-${med.id}`}
              value={{
                commissionRateType: med.commission_rate_type,
                commissionRate: med.commission_rate,
                commissionFlatKobo: med.commission_flat_kobo,
              }}
              isSaving={updateCommission.isPending && savingId === med.id}
              error={errorId === med.id ? (updateCommission.error as Error)?.message : null}
              onSave={(value) => {
                setSavingId(med.id);
                setErrorId(null);
                updateCommission.mutate(
                  { id: med.id, ...value },
                  { onError: () => setErrorId(med.id), onSettled: () => setSavingId(null) }
                );
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Mirrors labs-manager.tsx's PartnerLoginLinker — link a pharmacist login, and designate a partner admin who can invite further staff for the same pharmacy. */
function PartnerLoginLinker({
  pharmacy,
  logins,
}: {
  pharmacy: PharmacyPartner;
  logins: PharmacistLoginRow[];
}) {
  const link = useLinkPharmacist();
  const setPartnerAdmin = useSetPartnerAdmin();
  const [selected, setSelected] = useState("");
  const linkedToThisPharmacy = logins.filter((l) => l.pharmacy_partner_id === pharmacy.id);
  const unlinked = logins.filter((l) => l.pharmacy_partner_id === null);

  return (
    <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
      <p className="text-xs font-medium text-charcoal-ink/80">Partner logins for this pharmacy</p>
      {linkedToThisPharmacy.length === 0 ? (
        <p className="text-xs text-charcoal-ink/50">No partner login linked yet.</p>
      ) : (
        <ul className="space-y-1">
          {linkedToThisPharmacy.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5">
                {l.full_name ?? "Unnamed"} {l.email ? `· ${l.email}` : ""}
                {l.is_partner_admin && <Badge variant="blue">Partner admin</Badge>}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={setPartnerAdmin.isPending}
                  title="Lets this login invite further staff for this pharmacy"
                  onClick={() =>
                    setPartnerAdmin.mutate({ profileId: l.id, isPartnerAdmin: !l.is_partner_admin })
                  }
                >
                  {l.is_partner_admin ? "Revoke admin" : "Make partner admin"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={link.isPending}
                  onClick={() => link.mutate({ profileId: l.id, pharmacyPartnerId: null })}
                >
                  Unlink
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {link.error && <p className="text-xs text-red-600">{(link.error as Error).message}</p>}
      {setPartnerAdmin.error && (
        <p className="text-xs text-red-600">{(setPartnerAdmin.error as Error).message}</p>
      )}
      {unlinked.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-8 w-auto text-xs" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Link an existing pharmacist login…</option>
            {unlinked.map((l) => (
              <option key={l.id} value={l.id}>
                {l.full_name ?? "Unnamed"} {l.email ? `(${l.email})` : ""}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!selected || link.isPending}
            onClick={() => {
              link.mutate(
                { profileId: selected, pharmacyPartnerId: pharmacy.id },
                { onSuccess: () => setSelected("") }
              );
            }}
          >
            Link
          </Button>
        </div>
      ) : (
        <p className="text-xs text-charcoal-ink/50">
          No unlinked pharmacist logins available. Provision one at{" "}
          <span className="font-medium">Admin → Members</span> (role: Pharmacist) first.
        </p>
      )}
    </div>
  );
}

export function PharmaciesManager({ pharmacistLogins }: { pharmacistLogins: PharmacistLoginRow[] }) {
  const { data: pharmacies, isLoading } = useAllPharmacyPartners();
  const create = useCreatePharmacyPartner();
  const toggle = useSetPharmacyPartnerActive();
  const updateLicense = useUpdatePharmacyPartnerLicense();

  const [name, setName] = useState("");
  const [regions, setRegions] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [delivery, setDelivery] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a pharmacy partner</CardTitle>
          <CardDescription>
            Starts the onboarding pipeline (application → verification → activation, below). A
            new partner is never immediately active. Contact phone/email lets a partner pharmacy
            be notified of orders without logging in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              create.mutate(
                {
                  name,
                  regions: parseRegions(regions),
                  state: state || null,
                  city: city || null,
                  contactPhone: phone || null,
                  contactEmail: email || null,
                  delivery,
                  isActive: false,
                },
                {
                  onSuccess: () => {
                    setName("");
                    setRegions("");
                    setState("");
                    setCity("");
                    setPhone("");
                    setEmail("");
                    setDelivery(true);
                  },
                  onError: (err) => setError(err instanceof Error ? err.message : "Could not save"),
                }
              );
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="ph-name">Name</Label>
              <Input id="ph-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ph-regions">Regions (comma-separated)</Label>
              <Input id="ph-regions" value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="Lagos" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ph-state">State</Label>
              <Input id="ph-state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ph-city">City</Label>
              <Input id="ph-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ph-phone">Contact phone</Label>
              <Input id="ph-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2348012345678" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ph-email">Contact email</Label>
              <Input id="ph-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} />
              Offers delivery
            </label>
            {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Add pharmacy"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pharmacies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/60">Loading…</p>
          ) : (
            <SearchableList
              items={pharmacies ?? []}
              filterFn={(ph, q) =>
                ph.name.toLowerCase().includes(q) ||
                (ph.city ?? "").toLowerCase().includes(q) ||
                (ph.state ?? "").toLowerCase().includes(q) ||
                (ph.license_number ?? "").toLowerCase().includes(q) ||
                (ph.license_type ?? "").toLowerCase().includes(q) ||
                (ph.delivery && "delivery".includes(q))
              }
              searchPlaceholder="Search pharmacies by name, city, state, or license…"
              emptyMessage="No pharmacies yet."
              renderItem={(ph) => (
                <div key={ph.id} className="space-y-2 rounded-md border border-charcoal-ink/10 px-4 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-charcoal-ink">{ph.name}</span>
                      <Badge variant={ph.is_active ? "green" : "grey"}>{ph.is_active ? "Active" : "Inactive"}</Badge>
                      {ph.delivery && <Badge variant="blue">Delivery</Badge>}
                      <PartnerLicenseBadge expiresAt={ph.license_expires_at} />
                      {(ph.state || ph.city) && (
                        <span className="text-xs text-charcoal-ink/50">{[ph.city, ph.state].filter(Boolean).join(", ")}</span>
                      )}
                    </div>
                    {(ph.onboarding_status ?? "application") === "activated" && (
                      <Button
                        variant="outline"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: ph.id, isActive: !ph.is_active })}
                      >
                        {ph.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    )}
                  </div>
                  {ph.license_number && (
                    <p className="text-xs text-charcoal-ink/50">
                      {ph.license_type ?? "License"}: {ph.license_number}
                    </p>
                  )}
                  {!["activated", "rejected"].includes(ph.onboarding_status ?? "application") && (
                    <PharmacyOnboardingPanel pharmacy={ph} />
                  )}
                  {ph.onboarding_status === "rejected" && (
                    <p className="text-xs text-red-600">Rejected: {ph.rejection_reason}</p>
                  )}
                  <PartnerLicenseEditor
                    values={ph}
                    saving={updateLicense.isPending}
                    onSave={(next) => updateLicense.mutate({ id: ph.id, ...next })}
                  />
                  <PartnerLoginLinker pharmacy={ph} logins={pharmacistLogins} />
                  <AddPharmacyMedicationForm pharmacyId={ph.id} />
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <PharmacyCommissionRates />
    </div>
  );
}
