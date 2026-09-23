/**
 * Canonical Nigerian state list for the public signup dropdown.
 *
 * The public signup page can't read public.service_regions (RLS is authenticated-only), so
 * the list is duplicated here as a static constant. `value` MUST match the seeded
 * service_regions.state strings exactly (see 20260717100000_service_regions.sql) so the
 * region gate resolves — in particular the FCT row's value is "Abuja" to match existing
 * facilities/partner data. Post-login surfaces read service_regions live instead.
 */
export const NIGERIAN_STATES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Abia", label: "Abia" },
  { value: "Adamawa", label: "Adamawa" },
  { value: "Akwa Ibom", label: "Akwa Ibom" },
  { value: "Anambra", label: "Anambra" },
  { value: "Bauchi", label: "Bauchi" },
  { value: "Bayelsa", label: "Bayelsa" },
  { value: "Benue", label: "Benue" },
  { value: "Borno", label: "Borno" },
  { value: "Cross River", label: "Cross River" },
  { value: "Delta", label: "Delta" },
  { value: "Ebonyi", label: "Ebonyi" },
  { value: "Edo", label: "Edo" },
  { value: "Ekiti", label: "Ekiti" },
  { value: "Enugu", label: "Enugu" },
  { value: "Gombe", label: "Gombe" },
  { value: "Imo", label: "Imo" },
  { value: "Jigawa", label: "Jigawa" },
  { value: "Kaduna", label: "Kaduna" },
  { value: "Kano", label: "Kano" },
  { value: "Katsina", label: "Katsina" },
  { value: "Kebbi", label: "Kebbi" },
  { value: "Kogi", label: "Kogi" },
  { value: "Kwara", label: "Kwara" },
  { value: "Lagos", label: "Lagos" },
  { value: "Nasarawa", label: "Nasarawa" },
  { value: "Niger", label: "Niger" },
  { value: "Ogun", label: "Ogun" },
  { value: "Ondo", label: "Ondo" },
  { value: "Osun", label: "Osun" },
  { value: "Oyo", label: "Oyo" },
  { value: "Plateau", label: "Plateau" },
  { value: "Rivers", label: "Rivers" },
  { value: "Sokoto", label: "Sokoto" },
  { value: "Taraba", label: "Taraba" },
  { value: "Yobe", label: "Yobe" },
  { value: "Zamfara", label: "Zamfara" },
  { value: "Abuja", label: "Federal Capital Territory (Abuja)" },
];

const FCT_ALIASES = new Set(["fct", "federal capital territory", "abuja fct", "fct abuja"]);

/**
 * Mirrors private.normalize_ng_state (20260923212037_region_service_available_normalized_state_fallback.sql):
 * lowercases, trims, collapses whitespace, strips a trailing "state" suffix ("Lagos State"
 * -> "lagos"), and folds common FCT/Abuja spellings. Used client-side to compare a raw,
 * possibly-stale value (e.g. profiles.state, saved before the location field was a Select)
 * against NIGERIAN_STATES/service_regions without a round trip to the DB. Returns null for
 * blank/null input, matching the SQL function's null-for-blank behaviour.
 */
export function normalizeNigerianStateKey(value: string | null | undefined): string | null {
  const collapsed = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const stripped = collapsed.replace(/\s*state\s*$/i, "");
  if (!stripped) return null;
  return FCT_ALIASES.has(stripped) ? "abuja" : stripped;
}

// Precomputed once at module load — every canonical NIGERIAN_STATES entry keyed by its own
// normalized form (so an already-canonical value round-trips through the same map a
// variant does), avoiding a repeated 37-entry scan per lookup in the two helpers below.
const NORMALIZED_STATE_MAP: ReadonlyMap<string, string> = new Map(
  NIGERIAN_STATES.map((s) => [normalizeNigerianStateKey(s.value) as string, s.value]),
);

/**
 * Resolves a raw state string (e.g. a patient's on-file profiles.state) to its canonical
 * NIGERIAN_STATES spelling — exact match preferred, falling back to the same
 * casing/whitespace/"...State"-suffix-tolerant comparison region_service_available uses on
 * the DB side. Returns an empty string for blank/null/whitespace-only input (matching
 * normalizeNigerianStateKey's own null-for-blank behaviour), or the raw value unchanged
 * when it's non-blank but matches no canonical state (a genuinely non-Nigerian location,
 * e.g. a diaspora patient's home country, or a typo too garbled to recognise) — callers
 * still get *something* to prefill with, they just don't get a false canonicalisation.
 */
export function canonicalizeNigerianState(value: string | null | undefined): string {
  const key = normalizeNigerianStateKey(value);
  if (!key) return "";
  return NORMALIZED_STATE_MAP.get(key) ?? (value as string);
}

/** Whether a raw state string matches a canonical NIGERIAN_STATES entry, exactly or via normalizeNigerianStateKey. */
export function isRecognizedNigerianState(value: string | null | undefined): boolean {
  const key = normalizeNigerianStateKey(value);
  return key !== null && NORMALIZED_STATE_MAP.has(key);
}
