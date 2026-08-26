"use client";

import { useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared across home_visit_providers/logistics_partners — same pattern as
 * partner-license-fields.tsx. Address + geocoded lat/long, powering the
 * public /coverage partner map (public.public_partner_locations()). Address
 * drives the pin by default (via the "Geocode" button, when the map API is
 * loaded), but latitude/longitude stay directly editable so a wrong or
 * imprecise geocode result can be corrected by hand.
 */
export type PartnerLocationValues = {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function PartnerLocationBadge({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  const located = latitude !== null && longitude !== null;
  return (
    <Badge variant={located ? "green" : "grey"}>
      {located ? "Located" : "No location"}
    </Badge>
  );
}

export function PartnerLocationEditor({
  values,
  onSave,
  saving,
}: {
  values: PartnerLocationValues;
  onSave: (next: PartnerLocationValues) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(values.address ?? "");
  const [latitude, setLatitude] = useState(
    values.latitude !== null ? String(values.latitude) : "",
  );
  const [longitude, setLongitude] = useState(
    values.longitude !== null ? String(values.longitude) : "",
  );
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const geocodingLibrary = useMapsLibrary("geocoding");

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-charcoal-ink/60 underline"
        onClick={() => setOpen(true)}
      >
        Edit location
      </button>
    );
  }

  async function geocode() {
    if (!geocodingLibrary || !address.trim()) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const geocoder = new geocodingLibrary.Geocoder();
      const response = await geocoder.geocode({ address: address.trim() });
      const first = response.results[0];
      if (!first) {
        setGeocodeError(
          "No match found for that address — check it and try again, or enter coordinates directly.",
        );
        return;
      }
      setLatitude(String(first.geometry.location.lat()));
      setLongitude(String(first.geometry.location.lng()));
    } catch {
      setGeocodeError(
        "Could not geocode that address right now — enter coordinates directly instead.",
      );
    } finally {
      setGeocoding(false);
    }
  }

  return (
    <div className="mt-2 grid gap-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-3 sm:grid-cols-3">
      <div className="space-y-1 sm:col-span-3">
        <Label>Address</Label>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. 12 Adeola Odeku St, Victoria Island, Lagos"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!geocodingLibrary || geocoding || !address.trim()}
            onClick={geocode}
          >
            {geocoding ? "Geocoding…" : "Geocode"}
          </Button>
        </div>
        {!geocodingLibrary && (
          <p className="text-xs text-charcoal-ink/50">
            Geocoding needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY set — enter
            coordinates directly below in the meantime.
          </p>
        )}
        {geocodeError && <p className="text-xs text-red-600">{geocodeError}</p>}
      </div>
      <div className="space-y-1">
        <Label>Latitude</Label>
        <Input
          type="number"
          step="any"
          min={-90}
          max={90}
          value={latitude}
          onChange={(e) => setLatitude(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label>Longitude</Label>
        <Input
          type="number"
          step="any"
          min={-180}
          max={180}
          value={longitude}
          onChange={(e) => setLongitude(e.target.value)}
        />
      </div>
      <div className="flex items-end gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => {
            onSave({
              address: address.trim() || null,
              latitude: latitude.trim() ? Number(latitude) : null,
              longitude: longitude.trim() ? Number(longitude) : null,
            });
            setOpen(false);
          }}
        >
          {saving ? "Saving…" : "Save location"}
        </Button>
      </div>
    </div>
  );
}
