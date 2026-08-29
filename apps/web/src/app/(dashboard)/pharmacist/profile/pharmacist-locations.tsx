"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  usePharmacistOwnPartnerId,
  usePharmacistLocations,
  useCreatePharmacistLocation,
  useSetPharmacistLocationActive,
} from "@/lib/queries/pharmacist";

/**
 * Self-service branch management — the pharmacist-side counterpart of
 * apps/web/src/app/(dashboard)/lab-partner/lab-partner-facilities.tsx.
 * Writes to pharmacy_partner_locations (20260827203240), which
 * public_partner_locations() reads for the public /coverage map.
 */
export function PharmacistLocations() {
  const { data: partnerId } = usePharmacistOwnPartnerId();
  const { data: locations, isLoading } = usePharmacistLocations(partnerId);
  const create = useCreatePharmacistLocation();
  const toggle = useSetPharmacistLocationActive();

  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [address, setAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!partnerId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your branches</CardTitle>
        <CardDescription>
          Add every branch patients can be routed to. A branch only appears on the public coverage
          map once it has coordinates on file — contact support to have one geocoded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate(
              { partnerId, name, state, address, contactPhone },
              {
                onSuccess: () => {
                  setName("");
                  setState("");
                  setAddress("");
                  setContactPhone("");
                },
                onError: (err) => setError(err instanceof Error ? err.message : "Could not save"),
              }
            );
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ph-branch-name">Branch name</Label>
            <Input id="ph-branch-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ph-branch-state">State</Label>
            <Input id="ph-branch-state" value={state} onChange={(e) => setState(e.target.value)} required />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ph-branch-address">Address (optional)</Label>
            <Input id="ph-branch-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ph-branch-phone">Contact phone (E.164, optional)</Label>
            <Input
              id="ph-branch-phone"
              placeholder="+234…"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add branch"}
            </Button>
          </div>
        </form>

        <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/60">Loading…</p>
          ) : (locations ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No branches added yet.</p>
          ) : (
            (locations ?? []).map((loc) => (
              <div
                key={loc.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-4 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-charcoal-ink">{loc.name}</span>
                  <Badge variant={loc.is_active ? "green" : "grey"}>
                    {loc.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <span className="text-xs text-charcoal-ink/50">
                    {[loc.address, loc.state].filter(Boolean).join(", ")}
                  </span>
                  {(loc.latitude == null || loc.longitude == null) && (
                    <Badge variant="grey">Not on map yet</Badge>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: loc.id, isActive: !loc.is_active })}
                >
                  {loc.is_active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
