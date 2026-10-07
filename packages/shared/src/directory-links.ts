/**
 * Directions and one-tap call for a directory listing (S65, spec 15.16). Plain links only: the phone's own maps app and dialler open them.
 * There is no map SDK, no tracking pixel and no redirect through our servers, and nothing here reads the person's location (the maps app does
 * that itself if the person lets it).
 *
 * A telephone link is built ONLY for a listing's own number and only when it is a valid E.164 number. The emergency card never uses this file:
 * it carries no numbers at all (CMO decision Q18).
 */
export type MapsPlatform = "ios" | "android" | "web";

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** `tel:` link for a valid E.164 number, otherwise null (never a malformed dialler link). */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const p = phone.trim();
  return E164.test(p) ? `tel:${p}` : null;
}

function validCoords(lat: number | null | undefined, lng: number | null | undefined): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * A directions link. With coordinates: Android gets a `geo:` link (the phone offers every installed maps app), iOS gets Apple Maps, the
 * web gets a `geo:` link too, which a phone browser hands to its maps app and a desktop browser ignores harmlessly. With no coordinates
 * but an address, a search link by address; with neither, null (the screen then shows no directions button rather than a dead one).
 */
export function directionsHref(
  listing: { latitude?: number | null; longitude?: number | null; name?: string | null; address?: string | null },
  platform: MapsPlatform,
): string | null {
  const label = encodeURIComponent((listing.name ?? "").trim());
  if (validCoords(listing.latitude, listing.longitude)) {
    const { latitude: lat, longitude: lng } = listing as { latitude: number; longitude: number };
    if (platform === "ios") return `https://maps.apple.com/?daddr=${lat},${lng}${label ? `&q=${label}` : ""}`;
    return `geo:${lat},${lng}?q=${lat},${lng}${label ? `(${label})` : ""}`;
  }
  const address = (listing.address ?? "").trim();
  if (!address) return null;
  const q = encodeURIComponent(`${listing.name ?? ""} ${address}`.trim());
  return platform === "ios" ? `https://maps.apple.com/?q=${q}` : `geo:0,0?q=${q}`;
}
