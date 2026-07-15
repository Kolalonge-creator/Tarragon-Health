"use client";

import { useState } from "react";
import {
  useAllHomeVisitProviders,
  useAllLogisticsPartners,
  useCreateHomeVisitProvider,
  useCreateLogisticsPartner,
  useSetHomeVisitProviderActive,
  useSetLogisticsPartnerActive,
  type HomeVisitProvider,
  type LogisticsPartner,
} from "@/lib/queries/logistics-partners";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { koboToNaira, nairaToKobo } from "@tarragon/shared";

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function HomeVisitProvidersSection() {
  const { data: providers, isLoading, isError } = useAllHomeVisitProviders();
  const create = useCreateHomeVisitProvider();
  const setActive = useSetHomeVisitProviderActive();

  const [name, setName] = useState("");
  const [regions, setRegions] = useState("");
  const [sampleTypes, setSampleTypes] = useState("");
  const [feeNaira, setFeeNaira] = useState("");

  const canSubmit = name.trim().length > 0 && regions.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home visit providers</CardTitle>
        <CardDescription>
          Global catalogue — no organisation scoping, same posture as lab_providers/pharmacy_partners.
          A new row starts inactive by default here; activate it once a real partner contract exists.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load home visit providers.</p>}
        {providers && providers.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {providers.map((p: HomeVisitProvider) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">{p.name}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {p.regions.join(", ") || "No regions set"}
                    {p.sample_types.length > 0 && ` · ${p.sample_types.join(", ")}`} — ₦
                    {koboToNaira(p.home_visit_fee_kobo).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.is_active ? "green" : "grey"}>{p.is_active ? "Active" : "Inactive"}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: p.id, isActive: !p.is_active })}
                  >
                    {p.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">
            Add a home visit provider
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="hvp-name">Name</Label>
              <Input id="hvp-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hvp-regions">Regions (comma-separated)</Label>
              <Input
                id="hvp-regions"
                placeholder="Lagos, Abuja"
                value={regions}
                onChange={(e) => setRegions(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hvp-sample-types">Sample types (comma-separated)</Label>
              <Input
                id="hvp-sample-types"
                placeholder="blood, urine"
                value={sampleTypes}
                onChange={(e) => setSampleTypes(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hvp-fee">Home visit fee (₦)</Label>
              <Input
                id="hvp-fee"
                type="number"
                min={0}
                value={feeNaira}
                onChange={(e) => setFeeNaira(e.target.value)}
              />
            </div>
          </div>
          {create.isError && <p className="mt-2 text-sm text-red-600">{(create.error as Error).message}</p>}
          <Button
            size="sm"
            className="mt-2"
            disabled={!canSubmit || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  name: name.trim(),
                  regions: parseCommaList(regions),
                  sampleTypes: parseCommaList(sampleTypes),
                  homeVisitFeeKobo: nairaToKobo(Number(feeNaira) || 0),
                  isActive: false,
                },
                {
                  onSuccess: () => {
                    setName("");
                    setRegions("");
                    setSampleTypes("");
                    setFeeNaira("");
                  },
                }
              )
            }
          >
            {create.isPending ? "Adding…" : "Add provider"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LogisticsPartnersSection() {
  const { data: partners, isLoading, isError } = useAllLogisticsPartners();
  const create = useCreateLogisticsPartner();
  const setActive = useSetLogisticsPartnerActive();

  const [name, setName] = useState("");
  const [regions, setRegions] = useState("");
  const [feeNaira, setFeeNaira] = useState("");
  const [hours, setHours] = useState("");

  const canSubmit = name.trim().length > 0 && regions.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery / logistics partners</CardTitle>
        <CardDescription>
          Global catalogue, same posture as home visit providers above. Activating a row here is
          what turns on real delivery tracking for pharmacy orders in that region.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load logistics partners.</p>}
        {partners && partners.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {partners.map((p: LogisticsPartner) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">{p.name}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {p.regions.join(", ") || "No regions set"} — ₦
                    {koboToNaira(p.delivery_fee_kobo).toLocaleString()}
                    {p.estimated_delivery_hours ? ` · ~${p.estimated_delivery_hours}h` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.is_active ? "green" : "grey"}>{p.is_active ? "Active" : "Inactive"}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: p.id, isActive: !p.is_active })}
                  >
                    {p.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">
            Add a logistics partner
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="lp-name">Name</Label>
              <Input id="lp-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lp-regions">Regions (comma-separated)</Label>
              <Input
                id="lp-regions"
                placeholder="Lagos, Abuja"
                value={regions}
                onChange={(e) => setRegions(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lp-fee">Delivery fee (₦)</Label>
              <Input id="lp-fee" type="number" min={0} value={feeNaira} onChange={(e) => setFeeNaira(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lp-hours">Estimated delivery hours</Label>
              <Input id="lp-hours" type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
          </div>
          {create.isError && <p className="mt-2 text-sm text-red-600">{(create.error as Error).message}</p>}
          <Button
            size="sm"
            className="mt-2"
            disabled={!canSubmit || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  name: name.trim(),
                  regions: parseCommaList(regions),
                  deliveryFeeKobo: nairaToKobo(Number(feeNaira) || 0),
                  estimatedDeliveryHours: hours ? Number(hours) : null,
                  isActive: false,
                },
                {
                  onSuccess: () => {
                    setName("");
                    setRegions("");
                    setFeeNaira("");
                    setHours("");
                  },
                }
              )
            }
          >
            {create.isPending ? "Adding…" : "Add partner"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function LogisticsPartnersManager() {
  return (
    <div className="space-y-6">
      <HomeVisitProvidersSection />
      <LogisticsPartnersSection />
    </div>
  );
}
