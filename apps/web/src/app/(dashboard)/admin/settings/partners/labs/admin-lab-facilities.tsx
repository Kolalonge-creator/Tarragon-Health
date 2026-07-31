"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  useLabFacilities,
  useCreateLabFacility,
  useSetLabFacilityActive,
} from "@/lib/queries/partner-catalogues";

/**
 * Admin-side branch/address management for one lab. The partner can already
 * maintain its own list from /lab-partner once it has a linked login
 * (facilities_insert/update_lab_partner RLS) — this is the same capability
 * for an admin, useful before a partner login exists yet, or when ops wants
 * to add/correct an address directly.
 */
export function AdminLabFacilities({ labProviderId }: { labProviderId: string }) {
  const { data: facilities, isLoading } = useLabFacilities(labProviderId);
  const create = useCreateLabFacility();
  const toggle = useSetLabFacilityActive();

  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-3 rounded-md bg-charcoal-ink/5 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-charcoal-ink/80">Branches / addresses</p>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Add address"}
        </Button>
      </div>

      {showForm && (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate(
              { labProviderId, name, state, city, area, address, contactPhone },
              {
                onSuccess: () => {
                  setName("");
                  setState("");
                  setCity("");
                  setArea("");
                  setAddress("");
                  setContactPhone("");
                  setShowForm(false);
                },
                onError: (err) => setError(err instanceof Error ? err.message : "Could not save"),
              }
            );
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`admin-branch-name-${labProviderId}`} className="text-xs">Branch name</Label>
            <Input id={`admin-branch-name-${labProviderId}`} className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`admin-branch-state-${labProviderId}`} className="text-xs">State</Label>
            <Input id={`admin-branch-state-${labProviderId}`} className="h-8 text-xs" value={state} onChange={(e) => setState(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`admin-branch-city-${labProviderId}`} className="text-xs">City</Label>
            <Input id={`admin-branch-city-${labProviderId}`} className="h-8 text-xs" value={city} onChange={(e) => setCity(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`admin-branch-area-${labProviderId}`} className="text-xs">Area (optional)</Label>
            <Input id={`admin-branch-area-${labProviderId}`} className="h-8 text-xs" value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`admin-branch-address-${labProviderId}`} className="text-xs">Address (optional)</Label>
            <Input id={`admin-branch-address-${labProviderId}`} className="h-8 text-xs" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`admin-branch-phone-${labProviderId}`} className="text-xs">Contact phone (E.164, optional)</Label>
            <Input id={`admin-branch-phone-${labProviderId}`} className="h-8 text-xs" placeholder="+234…" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Save address"}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-xs text-charcoal-ink/60">Loading…</p>
      ) : (facilities ?? []).length === 0 ? (
        <p className="text-xs text-charcoal-ink/60">No branches on file for this lab yet.</p>
      ) : (
        <ul className="space-y-1">
          {(facilities ?? []).map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2">
                <span className="font-medium text-charcoal-ink">{f.name}</span>
                <Badge variant={f.is_active ? "green" : "grey"}>{f.is_active ? "Active" : "Inactive"}</Badge>
                <span className="text-charcoal-ink/50">{[f.area, f.city, f.state].filter(Boolean).join(", ")}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: f.id, isActive: !f.is_active })}
              >
                {f.is_active ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
