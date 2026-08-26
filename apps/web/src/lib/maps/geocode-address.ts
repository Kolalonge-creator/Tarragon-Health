/**
 * Wraps google.maps.Geocoder.geocode() in a real Promise via its callback
 * form. The loaded Maps JS API version's geocode() does not return a Promise
 * when called with no callback (returns undefined instead, despite what
 * @types/google.maps declares) — confirmed live via console testing, not
 * just from the type signature.
 */
export function geocodeAddress(
  geocoder: google.maps.Geocoder,
  address: string
): Promise<google.maps.GeocoderResult[]> {
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === "OK" && results) resolve(results);
      else reject(new Error(String(status)));
    });
  });
}
