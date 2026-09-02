"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateSpecialistProviderLocation,
  useSetSpecialistProviderLocationActive,
  useSpecialistProviderLocations,
} from "@/lib/queries/specialist-provider-network";

/** 66.2 "locations" (plural) — a specialist can practise from more than one branch, each with its own telemedicine/in-person support. */
export function SpecialistLocationsManager({ specialistProviderId }: { specialistProviderId: string }) {
  const [open, setOpen] = useState(false);
  const { data: locations, isLoading } = useSpecialistProviderLocations(open ? specialistProviderId : "");
  const create = useCreateSpecialistProviderLocation();
  const toggle = useSetSpecialistProviderLocationActive();

  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [telemedicine, setTelemedicine] = useState(false);
  const [inPerson, setInPerson] = useState(true);

  if (!open) {
    return (
      <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen(true)}>
        Manage locations
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-3">
      <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen(false)}>
        Hide locations
      </button>
      {isLoading ? (
        <p className="text-xs text-charcoal-ink/60">Loading…</p>
      ) : (locations ?? []).length === 0 ? (
        <p className="text-xs text-charcoal-ink/60">No locations on file yet — single location fields still apply.</p>
      ) : (
        <ul className="space-y-2">
          {(locations ?? []).map((loc) => (
            <li key={loc.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-charcoal-ink/10 p-2">
              <div className="text-xs text-charcoal-ink/80">
                <span className="font-medium">{loc.name}</span> — {[loc.city, loc.state].filter(Boolean).join(", ")}
                <div className="text-charcoal-ink/50">{loc.address}</div>
                <div className="mt-1 flex gap-1">
                  {loc.supports_telemedicine && <Badge variant="blue">Telemedicine</Badge>}
                  {loc.supports_in_person && <Badge variant="blue">In person</Badge>}
                  <Badge variant={loc.is_active ? "green" : "grey"}>{loc.is_active ? "Active" : "Inactive"}</Badge>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={toggle.isPending}
                onClick={() =>
                  toggle.mutate({ id: loc.id, specialistProviderId, isActive: !loc.is_active })
                }
              >
                {loc.is_active ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            {
              specialistProviderId,
              name,
              state,
              city: city || null,
              address,
              contactPhone: null,
              supportsTelemedicine: telemedicine,
              supportsInPerson: inPerson,
            },
            {
              onSuccess: () => {
                setName("");
                setState("");
                setCity("");
                setAddress("");
                setTelemedicine(false);
                setInPerson(true);
              },
            }
          );
        }}
      >
        <div className="space-y-1">
          <Label>Branch name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label>State</Label>
          <Input value={state} onChange={(e) => setState(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label>City</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Address</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} required />
        </div>
        <label className="flex items-center gap-2 text-xs text-charcoal-ink/80">
          <input type="checkbox" checked={telemedicine} onChange={(e) => setTelemedicine(e.target.checked)} />
          Telemedicine here
        </label>
        <label className="flex items-center gap-2 text-xs text-charcoal-ink/80">
          <input type="checkbox" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} />
          In-person here
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Add location"}
          </Button>
        </div>
      </form>
    </div>
  );
}
