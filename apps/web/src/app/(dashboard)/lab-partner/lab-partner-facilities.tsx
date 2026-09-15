"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  useLabPartnerOwnProviderId,
  useLabPartnerFacilities,
  useCreateLabPartnerFacility,
  useSetLabPartnerFacilityActive,
} from "@/lib/queries/lab-partner";

/**
 * Self-service branch/location management. Writes to lab_provider_locations
 * — the table that actually feeds the public /coverage map via
 * public_partner_locations(). A real partner with dozens of branches
 * maintains its own list directly; RLS (lab_provider_locations_*_partner,
 * 20260827203240) scopes every write to this lab's own rows.
 */
export function LabPartnerFacilities() {
  const { data: providerId } = useLabPartnerOwnProviderId();
  const { data: facilities, isLoading } = useLabPartnerFacilities(providerId);
  const create = useCreateLabPartnerFacility();
  const toggle = useSetLabPartnerFacilityActive();

  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [address, setAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!providerId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your branches</CardTitle>
        <CardDescription>
          Patients pick from this list when booking with your lab. Keep it accurate. Retiring a
          branch deactivates it rather than deleting it. A branch only appears on the public
          coverage map once it has coordinates on file. Contact support to have one geocoded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate(
              { providerId, name, state, address, contactPhone },
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
            <Label htmlFor="branch-name">Branch name</Label>
            <Input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="branch-state">State</Label>
            <Input id="branch-state" value={state} onChange={(e) => setState(e.target.value)} required />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="branch-address">Address</Label>
            <Input
              id="branch-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="branch-phone">Contact phone (E.164, optional)</Label>
            <Input
              id="branch-phone"
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
          ) : (facilities ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No branches added yet.</p>
          ) : (
            (facilities ?? []).map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-4 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-charcoal-ink">{f.name}</span>
                  <Badge variant={f.is_active ? "green" : "grey"}>{f.is_active ? "Active" : "Inactive"}</Badge>
                  <span className="text-xs text-charcoal-ink/50">
                    {[f.address, f.state].filter(Boolean).join(", ")}
                  </span>
                  {(f.latitude == null || f.longitude == null) && (
                    <Badge variant="grey">Not on map yet</Badge>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: f.id, isActive: !f.is_active })}
                >
                  {f.is_active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
