import { resolveNigerianState } from "@/lib/nigeria-states";

/**
 * Turns a Google Places (New) result into the address fields the admin partner forms store. Pure, so it is tested without the
 * Maps API: the component hands it the result of Place.fetchFields({ fields: ["formattedAddress", "location", "addressComponents"] }).
 *
 * `state` is only filled when Google's first-level area resolves to one of the canonical NIGERIAN_STATES values (so "Lagos State"
 * becomes "Lagos" and "Federal Capital Territory" becomes "Abuja", matching service_regions.state); anything else is left null for
 * the admin to type, never guessed. `town` prefers the locality, then the second-level area (the LGA), then a sublocality.
 */
export type PlaceAddressComponent = {
  readonly longText: string | null;
  readonly shortText: string | null;
  readonly types: readonly string[];
};

export type PlaceLike = {
  readonly formattedAddress?: string | null;
  readonly location?: { lat(): number; lng(): number } | null;
  readonly addressComponents?: readonly PlaceAddressComponent[] | null;
};

export type PlaceAddress = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  state: string | null;
  town: string | null;
};

function component(place: PlaceLike, type: string): string | null {
  const found = (place.addressComponents ?? []).find((c) => c.types.includes(type));
  const text = found?.longText?.trim();
  return text ? text : null;
}

export function placeToAddress(place: PlaceLike, fallbackText: string): PlaceAddress {
  const lat = place.location?.lat();
  const lng = place.location?.lng();
  const located = typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng);
  const stateResolution = resolveNigerianState(component(place, "administrative_area_level_1"));
  return {
    address: place.formattedAddress?.trim() || fallbackText.trim(),
    latitude: located ? lat : null,
    longitude: located ? lng : null,
    state: stateResolution.recognized ? stateResolution.canonical : null,
    town: component(place, "locality") ?? component(place, "administrative_area_level_2") ?? component(place, "sublocality"),
  };
}
