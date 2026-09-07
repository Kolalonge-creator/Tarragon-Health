"use client";

import { useState, useEffect } from "react";
import { useLabTestLocations } from "@/lib/queries/lab-orders";

/**
 * §56.7 booking flow, location step: "test required → location → available
 * slot → preparation → payment/coverage → booking". Lists every active
 * laboratory branch that offers the tests in the selected bundle, and feeds
 * the chosen provider_id into the hidden form field
 * createAndPayForPartnerLabOrder now reads.
 *
 * With exactly one location (today's real state — Synlab only, one branch
 * seeded in most states), this renders as a single read-only summary rather
 * than a pointless one-option radio group, and still emits the same hidden
 * providerId field so the booking flow behaves identically whether there is
 * one lab or several.
 */
export function LabLocationPicker({
  testCode,
  state,
  onProviderChange,
}: {
  /** One representative test code from the selected bundle — location
   * availability is asked per-test (a branch that doesn't run this test
   * shouldn't be offered), not per-bundle. */
  testCode: string | null;
  state?: string | null;
  onProviderChange?: (providerId: string | null) => void;
}) {
  const { data: locations, isLoading } = useLabTestLocations(testCode, state);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  const list = locations ?? [];
  const selected = list.find((l) => l.location_id === selectedLocationId) ?? list[0] ?? null;

  useEffect(() => {
    onProviderChange?.(selected?.provider_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.provider_id]);

  if (isLoading) return <p className="text-xs text-charcoal-ink/60">Finding a lab near you…</p>;
  if (list.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Where to give your sample
      </p>
      {list.length === 1 ? (
        <p className="text-xs text-charcoal-ink/70">
          {list[0].provider_name} — {list[0].location_name}, {list[0].location_state}
        </p>
      ) : (
        <div className="space-y-1">
          {list.map((loc) => (
            <label
              key={loc.location_id}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-charcoal-ink/10 p-2 text-xs hover:border-charcoal-ink/25"
            >
              <input
                type="radio"
                name="lab-location"
                className="mt-0.5"
                checked={(selected?.location_id ?? list[0].location_id) === loc.location_id}
                onChange={() => setSelectedLocationId(loc.location_id)}
              />
              <span>
                <span className="font-medium text-charcoal-ink">{loc.provider_name}</span>
                {" — "}
                {loc.location_name}, {loc.location_state}
              </span>
            </label>
          ))}
        </div>
      )}
      <input type="hidden" name="providerId" value={selected?.provider_id ?? ""} />
    </div>
  );
}
