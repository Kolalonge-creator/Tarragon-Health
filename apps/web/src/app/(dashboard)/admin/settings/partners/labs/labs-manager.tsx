"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { CommissionRateEditor } from "@/components/admin/commission-rate-editor";
import {
  useAllLabProviders,
  useCreateLabProvider,
  useSetLabProviderActive,
  useUpdateLabProviderContact,
  useLabProviderTurnaroundStats,
  useLinkLabPartner,
  useUpdateLabProviderLicense,
  useAllPanelBundles,
  useUpdatePanelBundleCommission,
  type LabPartnerLoginRow,
  type LabProvider,
} from "@/lib/queries/partner-catalogues";
import { AdminLabFacilities } from "./admin-lab-facilities";
import { AdminLabProviderLocations } from "./admin-lab-provider-locations";
import {
  PartnerLicenseBadge,
  PartnerLicenseEditor,
} from "@/components/admin/partner-license-fields";
import { MapsProvider } from "@/components/admin/maps-provider";
import { koboToNaira } from "@tarragon/shared";

function parseRegions(raw: string): string[] {
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

function TurnaroundBadge({ providerId }: { providerId: string }) {
  const { data: stats, isLoading } = useLabProviderTurnaroundStats();
  const row = stats?.find((s) => s.provider_id === providerId);

  if (isLoading)
    return (
      <span className="text-xs text-charcoal-ink/40">Loading turnaround…</span>
    );
  if (!row || row.suppressed) {
    return (
      <span className="text-xs text-charcoal-ink/50">
        Turnaround: not enough resulted orders yet (last 90 days)
      </span>
    );
  }
  const over = row.pct_over_72h ?? 0;
  return (
    <span className="text-xs text-charcoal-ink/70">
      Turnaround (90d): {row.orders_resulted} resulted · avg{" "}
      {row.avg_turnaround_hours}h · median {row.median_turnaround_hours}h ·{" "}
      <span className={over > 20 ? "font-medium text-amber-700" : ""}>
        {over}% over 72h
      </span>
    </span>
  );
}

function ContactEditor({ lab }: { lab: LabProvider }) {
  const update = useUpdateLabProviderContact();
  const [email, setEmail] = useState(lab.contact_email ?? "");
  const [phone, setPhone] = useState(lab.contact_phone ?? "");
  const [saved, setSaved] = useState(false);
  const isPlaceholder = (lab.contact_email ?? "").endsWith(".example");

  return (
    <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
      {isPlaceholder && (
        <p className="text-xs text-amber-700">
          This is a seeded placeholder address — order notifications for this
          lab won&apos;t reach anyone real until it&apos;s replaced.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`contact-email-${lab.id}`} className="text-xs">
            Contact email
          </Label>
          <Input
            id={`contact-email-${lab.id}`}
            type="email"
            className="h-8 text-xs"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`contact-phone-${lab.id}`} className="text-xs">
            Contact phone (E.164)
          </Label>
          <Input
            id={`contact-phone-${lab.id}`}
            className="h-8 text-xs"
            placeholder="+234…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>
      {update.error && (
        <p className="text-xs text-red-600">
          {(update.error as Error).message}
        </p>
      )}
      {saved && !update.isPending && (
        <p className="text-xs text-brand-green">Saved.</p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={update.isPending}
        onClick={() => {
          setSaved(false);
          update.mutate(
            {
              id: lab.id,
              contactEmail: email.trim() || null,
              contactPhone: phone.trim() || null,
            },
            { onSuccess: () => setSaved(true) },
          );
        }}
      >
        {update.isPending ? "Saving…" : "Save contact info"}
      </Button>
    </div>
  );
}

function PartnerLoginLinker({
  lab,
  logins,
}: {
  lab: LabProvider;
  logins: LabPartnerLoginRow[];
}) {
  const link = useLinkLabPartner();
  const [selected, setSelected] = useState("");
  const linkedToThisLab = logins.filter((l) => l.lab_provider_id === lab.id);
  const unlinked = logins.filter((l) => l.lab_provider_id === null);

  return (
    <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
      <p className="text-xs font-medium text-charcoal-ink/80">
        Partner logins for this lab
      </p>
      {linkedToThisLab.length === 0 ? (
        <p className="text-xs text-charcoal-ink/50">
          No partner login linked yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {linkedToThisLab.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span>
                {l.full_name ?? "Unnamed"} {l.email ? `· ${l.email}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={link.isPending}
                onClick={() =>
                  link.mutate({ profileId: l.id, labProviderId: null })
                }
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      {link.error && (
        <p className="text-xs text-red-600">{(link.error as Error).message}</p>
      )}
      {unlinked.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="h-8 w-auto text-xs"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Link an existing lab_partner login…</option>
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
                { profileId: selected, labProviderId: lab.id },
                { onSuccess: () => setSelected("") },
              );
            }}
          >
            Link
          </Button>
        </div>
      ) : (
        <p className="text-xs text-charcoal-ink/50">
          No unlinked lab_partner logins available — provision one at{" "}
          <span className="font-medium">Admin → Members</span> (role: Lab
          Partner) first.
        </p>
      )}
    </div>
  );
}

function LabCommissionRates() {
  const { data: bundles, isLoading } = useAllPanelBundles();
  const updateCommission = useUpdatePanelBundleCommission();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab tests &amp; bundles — commission rates</CardTitle>
        <CardDescription>
          This is what actually drives every &quot;lab&quot; commission on the
          Commissions dashboard — a lab order&apos;s commission is computed from
          the bundle it books, not from the lab provider itself. Changing a rate
          here only affects orders placed after the change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {bundles && bundles.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No lab bundles yet.</p>
        )}
        {(bundles ?? []).map((bundle) => (
          <div
            key={bundle.id}
            className="space-y-2 rounded-md border border-charcoal-ink/10 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-charcoal-ink">
                {bundle.name}
              </span>
              <Badge variant="grey">{bundle.code}</Badge>
              <Badge variant={bundle.is_active ? "green" : "grey"}>
                {bundle.is_active ? "Active" : "Inactive"}
              </Badge>
              <span className="text-xs text-charcoal-ink/50">
                Price ₦{koboToNaira(bundle.price_kobo).toLocaleString()}
              </span>
            </div>
            <CommissionRateEditor
              idPrefix={`bundle-${bundle.id}`}
              value={{
                commissionRateType: bundle.commission_rate_type,
                commissionRate: bundle.commission_rate,
                commissionFlatKobo: bundle.commission_flat_kobo,
              }}
              isSaving={updateCommission.isPending && savingId === bundle.id}
              error={
                errorId === bundle.id
                  ? (updateCommission.error as Error)?.message
                  : null
              }
              onSave={(value) => {
                setSavingId(bundle.id);
                setErrorId(null);
                updateCommission.mutate(
                  { id: bundle.id, ...value },
                  {
                    onError: () => setErrorId(bundle.id),
                    onSettled: () => setSavingId(null),
                  },
                );
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function LabsManager({
  labPartnerLogins,
}: {
  labPartnerLogins: LabPartnerLoginRow[];
}) {
  const { data: labs, isLoading } = useAllLabProviders();
  const create = useCreateLabProvider();
  const toggle = useSetLabProviderActive();
  const updateLicense = useUpdateLabProviderLicense();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [regions, setRegions] = useState("");
  const [homeCollection, setHomeCollection] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <MapsProvider>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Add a lab provider</CardTitle>
            <CardDescription>
              Patients can book at an active lab covering their region.
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
                    homeCollection,
                    isActive,
                  },
                  {
                    onSuccess: () => {
                      setName("");
                      setRegions("");
                      setHomeCollection(false);
                      setIsActive(true);
                    },
                    onError: (err) =>
                      setError(
                        err instanceof Error ? err.message : "Could not save",
                      ),
                  },
                );
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="lab-name">Name</Label>
                <Input
                  id="lab-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lab-regions">Regions (comma-separated)</Label>
                <Input
                  id="lab-regions"
                  value={regions}
                  onChange={(e) => setRegions(e.target.value)}
                  placeholder="Lagos, Abuja"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
                <input
                  type="checkbox"
                  checked={homeCollection}
                  onChange={(e) => setHomeCollection(e.target.checked)}
                />
                Offers home sample collection
              </label>
              <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
              </label>
              {error && (
                <p className="text-sm text-red-600 sm:col-span-2">{error}</p>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Saving…" : "Add lab"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Labs</CardTitle>
            <CardDescription>
              Contact details, turnaround performance, and partner login links.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-charcoal-ink/60">Loading…</p>
            ) : (labs ?? []).length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">No labs yet.</p>
            ) : (
              (labs ?? []).map((lab) => {
                const expanded = expandedId === lab.id;
                return (
                  <div
                    key={lab.id}
                    className="rounded-md border border-charcoal-ink/10 px-4 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-charcoal-ink">
                          {lab.name}
                        </span>
                        <Badge variant={lab.is_active ? "green" : "grey"}>
                          {lab.is_active ? "Active" : "Inactive"}
                        </Badge>
                        {lab.home_collection && (
                          <Badge variant="blue">Home collection</Badge>
                        )}
                        <PartnerLicenseBadge
                          expiresAt={lab.license_expires_at}
                        />
                        {lab.regions.length > 0 && (
                          <span className="text-xs text-charcoal-ink/50">
                            {lab.regions.join(", ")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExpandedId(expanded ? null : lab.id)
                          }
                        >
                          {expanded ? "Hide details" : "Manage"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({
                              id: lab.id,
                              isActive: !lab.is_active,
                            })
                          }
                        >
                          {lab.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-1">
                      <TurnaroundBadge providerId={lab.id} />
                    </div>
                    {expanded && (
                      <div className="mt-3 space-y-3 border-t border-charcoal-ink/10 pt-3">
                        <ContactEditor lab={lab} />
                        {lab.license_number && (
                          <p className="text-xs text-charcoal-ink/50">
                            {lab.license_type ?? "License"}:{" "}
                            {lab.license_number}
                          </p>
                        )}
                        <PartnerLicenseEditor
                          values={lab}
                          saving={updateLicense.isPending}
                          onSave={(next) =>
                            updateLicense.mutate({ id: lab.id, ...next })
                          }
                        />
                        <AdminLabProviderLocations labProviderId={lab.id} />
                        <AdminLabFacilities labProviderId={lab.id} />
                        <PartnerLoginLinker
                          lab={lab}
                          logins={labPartnerLogins}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <LabCommissionRates />
      </div>
    </MapsProvider>
  );
}
