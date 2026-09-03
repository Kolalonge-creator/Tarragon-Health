"use client";

import { useState } from "react";
import {
  APIProvider,
  InfoWindow,
  Map,
  Marker,
} from "@vis.gl/react-google-maps";
import type { PartnerLocation } from "@/lib/marketing/partner-locations-data";

// Same raw-hex convention as og-card.tsx's BRAND_GREEN — Google Maps marker
// icons take a plain color string, not a Tailwind class.
const BRAND_GREEN = "#0E7C52";

const TYPE_LABEL: Record<PartnerLocation["type"], string> = {
  home_visit: "Home visit collection",
  delivery: "Delivery courier",
  lab: "Contracted lab",
};

const TYPE_LETTER: Record<PartnerLocation["type"], string> = {
  home_visit: "H",
  delivery: "D",
  lab: "L",
};

function centroid(locations: PartnerLocation[]) {
  const lat =
    locations.reduce((sum, l) => sum + l.latitude, 0) / locations.length;
  const lng =
    locations.reduce((sum, l) => sum + l.longitude, 0) / locations.length;
  return { lat, lng };
}

/**
 * Only ever mounted when `locations` is non-empty (see page.tsx) — every row
 * here already passed public_partner_locations()'s is_active filter, so
 * every pin is definitionally "live." There is no grey/"not yet" pin state on
 * the map itself; absence of a pin is what signals "not yet," same
 * convention as the zone picker in coverage-checker.tsx.
 */
export function PartnerMap({
  locations,
  apiKey,
}: {
  locations: PartnerLocation[];
  apiKey: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = locations.find((l) => l.id === selectedId) ?? null;

  return (
    <div>
      <APIProvider apiKey={apiKey}>
        <div className="h-96 w-full overflow-hidden rounded-2xl border border-charcoal-ink/10">
          <Map
            defaultCenter={centroid(locations)}
            defaultZoom={locations.length > 1 ? 6 : 12}
            gestureHandling="cooperative"
          >
            {locations.map((location) => (
              <Marker
                key={location.id}
                position={{ lat: location.latitude, lng: location.longitude }}
                title={`${location.name}: ${TYPE_LABEL[location.type]}`}
                label={{
                  text: TYPE_LETTER[location.type],
                  color: "#ffffff",
                  fontSize: "10px",
                  fontWeight: "bold",
                }}
                icon={{
                  path: 0, // google.maps.SymbolPath.CIRCLE (value is a stable part of the Maps JS API's public enum)
                  scale: 10,
                  fillColor: BRAND_GREEN,
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 2,
                }}
                onClick={() => setSelectedId(location.id)}
              />
            ))}
            {selected && (
              <InfoWindow
                position={{ lat: selected.latitude, lng: selected.longitude }}
                onCloseClick={() => setSelectedId(null)}
              >
                <div className="max-w-xs p-1">
                  <p className="font-heading text-sm font-semibold text-charcoal-ink">
                    {selected.name}
                  </p>
                  <p className="text-xs text-charcoal-ink/60">
                    {TYPE_LABEL[selected.type]}
                  </p>
                  <p className="mt-1 text-xs text-charcoal-ink/70">
                    {selected.address}
                  </p>
                </div>
              </InfoWindow>
            )}
          </Map>
        </div>
      </APIProvider>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-charcoal-ink/60">
        {(
          Object.entries(TYPE_LABEL) as [PartnerLocation["type"], string][]
        ).map(([type, label]) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-green text-[9px] font-bold text-white"
            >
              {TYPE_LETTER[type]}
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
