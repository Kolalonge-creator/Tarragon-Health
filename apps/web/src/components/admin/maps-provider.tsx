"use client";

import { APIProvider } from "@vis.gl/react-google-maps";

/**
 * Wraps admin partner-catalogue pages that use PartnerLocationEditor's
 * "Geocode" button (logistics-partners-manager.tsx, labs-manager.tsx, and
 * any future one). Without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY set, renders
 * children directly — PartnerLocationEditor's own useMapsLibrary("geocoding")
 * call then just returns null and the button disables itself, same fail-soft
 * posture as the public /coverage map.
 */
export function MapsProvider({ children }: { children: React.ReactNode }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return <>{children}</>;
  return <APIProvider apiKey={apiKey}>{children}</APIProvider>;
}
