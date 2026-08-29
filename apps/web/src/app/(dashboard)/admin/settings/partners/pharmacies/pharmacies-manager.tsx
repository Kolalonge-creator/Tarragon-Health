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
import {
  useAllPharmacyPartners,
  useCreatePharmacyPartner,
  useSetPharmacyPartnerActive,
  useUpdatePharmacyPartnerLicense,
  useAllPharmacyMedications,
  useUpdatePharmacyMedicationCommission,
  useLinkPharmacist,
  useSetPartnerAdmin,
  type PharmacyPartner,
  type PharmacistLoginRow,
} from "@/lib/queries/partner-catalogues";
import { koboToNaira } from "@tarragon/shared";

function parseRegions(raw: string): string[] {
  return raw.split(",").map((r) => r.trim()).filter(Boolean);
}

function PharmacyCommissionRates() {
  const { data: medications, isLoading } = useAllPharmacyMedications();
  const updateCommission = useUpdatePharmacyMedicationCommission();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pharmacy medications — commission rates</CardTitle>
        <CardDescription>
          This is what actually drives every &quot;pharmacy&quot; commission on the Commissions
          dashboard — computed per medication at order time, not from the pharmacy partner
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
          No unlinked pharmacist logins available — provision one at{" "}
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
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a pharmacy partner</CardTitle>
          <CardDescription>
            Contact phone/email lets a partner pharmacy be notified of orders without logging in.
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
                  isActive,
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
                    setIsActive(true);
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
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
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
          ) : (pharmacies ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No pharmacies yet.</p>
          ) : (
            (pharmacies ?? []).map((ph) => (
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
                  <Button
                    variant="outline"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: ph.id, isActive: !ph.is_active })}
                  >
                    {ph.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
                {ph.license_number && (
                  <p className="text-xs text-charcoal-ink/50">
                    {ph.license_type ?? "License"}: {ph.license_number}
                  </p>
                )}
                <PartnerLicenseEditor
                  values={ph}
                  saving={updateLicense.isPending}
                  onSave={(next) => updateLicense.mutate({ id: ph.id, ...next })}
                />
                <PartnerLoginLinker pharmacy={ph} logins={pharmacistLogins} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <PharmacyCommissionRates />
    </div>
  );
}
