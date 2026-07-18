"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  useAllPharmacyPartners,
  useCreatePharmacyPartner,
  useSetPharmacyPartnerActive,
} from "@/lib/queries/partner-catalogues";

function parseRegions(raw: string): string[] {
  return raw.split(",").map((r) => r.trim()).filter(Boolean);
}

export function PharmaciesManager() {
  const { data: pharmacies, isLoading } = useAllPharmacyPartners();
  const create = useCreatePharmacyPartner();
  const toggle = useSetPharmacyPartnerActive();

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
              <div key={ph.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-charcoal-ink">{ph.name}</span>
                  <Badge variant={ph.is_active ? "green" : "grey"}>{ph.is_active ? "Active" : "Inactive"}</Badge>
                  {ph.delivery && <Badge variant="blue">Delivery</Badge>}
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
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
