"use client";

import { useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { geocodeAddress } from "@/lib/maps/geocode-address";
import {
  useLabProviderLocations,
  useCreateLabProviderLocation,
  useSetLabProviderLocationActive,
  useUpdateLabProviderLocationGeo,
  type LabProviderLocation,
} from "@/lib/queries/partner-catalogues";

/**
 * Branch-level locations for a contracted lab (lab_provider_locations) —
 * distinct from AdminLabFacilities, which manages the separate, still-
 * suspended public.facilities table. This one powers public_partner_
 * locations() / the public /coverage map, so a branch only ever shows a
 * public pin once it is both is_active and geocoded here.
 */
function GeocodeButton({ location }: { location: LabProviderLocation }) {
  const geocodingLibrary = useMapsLibrary("geocoding");
  const updateGeo = useUpdateLabProviderLocationGeo();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const located = location.latitude !== null && location.longitude !== null;

  async function geocode() {
    if (!geocodingLibrary) return;
    setBusy(true);
    setError(null);
    try {
      const geocoder = new geocodingLibrary.Geocoder();
      const results = await geocodeAddress(geocoder, location.address);
      const first = results[0];
      if (!first) {
        setError("No match found.");
        return;
      }
      updateGeo.mutate({
        id: location.id,
        labProviderId: location.lab_provider_id,
        latitude: first.geometry.location.lat(),
        longitude: first.geometry.location.lng(),
      });
    } catch (e) {
      setError(e instanceof Error ? `Geocoding failed: ${e.message}` : "Geocoding failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={located ? "green" : "grey"}>
        {located ? "Located" : "No location"}
      </Badge>
      {!located && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={!geocodingLibrary || busy}
          onClick={geocode}
        >
          {busy ? "Geocoding…" : "Geocode"}
        </Button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function AdminLabProviderLocations({
  labProviderId,
}: {
  labProviderId: string;
}) {
  const { data: locations, isLoading } = useLabProviderLocations(labProviderId);
  const create = useCreateLabProviderLocation();
  const setActive = useSetLabProviderLocationActive();

  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  const locatedCount = (locations ?? []).filter(
    (l) => l.latitude !== null && l.longitude !== null,
  ).length;

  const grouped = (locations ?? []).reduce<
    Record<string, LabProviderLocation[]>
  >((acc, loc) => {
    (acc[loc.state] ??= []).push(loc);
    return acc;
  }, {});

  return (
    <div className="space-y-3 rounded-md bg-charcoal-ink/5 p-3">
      <p className="text-xs font-medium text-charcoal-ink/80">
        Branch locations
        {locations &&
          locations.length > 0 &&
          ` (${locatedCount}/${locations.length} geocoded)`}
      </p>
      {isLoading && <p className="text-xs text-charcoal-ink/50">Loading…</p>}
      {locations && locations.length === 0 && (
        <p className="text-xs text-charcoal-ink/50">No branch locations yet.</p>
      )}

      {Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([stateName, locs]) => (
          <div key={stateName}>
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
              {stateName}
            </p>
            <ul className="mt-1 space-y-1.5">
              {locs.map((loc) => (
                <li
                  key={loc.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-charcoal-ink/10 bg-white p-2 text-xs"
                >
                  <div>
                    <p className="font-medium text-charcoal-ink">
                      {loc.name}{" "}
                      {!loc.is_active && <Badge variant="grey">Inactive</Badge>}
                    </p>
                    <p className="text-charcoal-ink/60">{loc.address}</p>
                    {loc.contact_phone && (
                      <p className="text-charcoal-ink/50">
                        {loc.contact_phone}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <GeocodeButton location={loc} />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      disabled={setActive.isPending}
                      onClick={() =>
                        setActive.mutate({
                          id: loc.id,
                          labProviderId,
                          isActive: !loc.is_active,
                        })
                      }
                    >
                      {loc.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

      <div className="rounded border border-charcoal-ink/10 bg-white p-2">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">
          Add a branch
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="Branch name"
            className="h-8 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="State"
            className="h-8 text-xs"
            value={state}
            onChange={(e) => setState(e.target.value)}
          />
          <Input
            placeholder="Address"
            className="h-8 text-xs sm:col-span-2"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Input
            placeholder="Phone (+234…)"
            className="h-8 text-xs"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {create.isError && (
          <p className="mt-1 text-xs text-red-600">
            {(create.error as Error).message}
          </p>
        )}
        <Button
          size="sm"
          className="mt-2"
          disabled={
            !name.trim() || !state.trim() || !address.trim() || create.isPending
          }
          onClick={() =>
            create.mutate(
              {
                labProviderId,
                name: name.trim(),
                state: state.trim(),
                address: address.trim(),
                contactPhone: phone.trim() || null,
              },
              {
                onSuccess: () => {
                  setName("");
                  setState("");
                  setAddress("");
                  setPhone("");
                },
              },
            )
          }
        >
          {create.isPending ? "Adding…" : "Add branch"}
        </Button>
      </div>
    </div>
  );
}
