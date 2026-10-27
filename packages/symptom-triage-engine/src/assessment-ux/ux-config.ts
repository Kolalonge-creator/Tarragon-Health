/**
 * S59c: the shared envelope of the four assessment-experience configs (follow-up check-back, describe-it synonyms, result explainer,
 * safety-net advice).
 *
 * THE PATTERN IS THE S59 ONE (urgency map, context tightening). Every config here is PROPOSED, versioned, and ships as an UNSIGNED DRAFT.
 * A config is only "in force" when it parses, says `signed_off`, and carries a named signer and a date. Anything else (a draft, a
 * malformed row, a missing row, a copy that differs from the live signed version) means the feature falls back to the safe behaviour it
 * had before: no match is suggested, no explanation is shown, only the generic safety net is shown, no check-back is scheduled.
 * Nothing in this package signs anything.
 *
 * WHICH COPY IS TRUSTED. The app bundles a copy of each config so the screens work offline (like the red-flag floor). A bundled copy is
 * trusted only when it is signed AND, when the app can reach the server, it equals the live signed version. A signed bundle that the
 * server cannot confirm (a different version, or no signed version at all) is treated as not in force and reported as drift.
 */
import { z } from "zod";

export const signOffSchema = z
  .object({ by: z.string().min(1), at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();

export const provenanceSchema = z.object({ source: z.string().min(1), note: z.string().min(1) }).strict();

/** The fields every config carries. */
export const envelopeShape = {
  version: z.number().int().min(1),
  status: z.enum(["draft", "signed_off"]),
  clinical_sign_off: signOffSchema.nullable(),
  provenance: provenanceSchema,
} as const;

export interface Envelope {
  status: "draft" | "signed_off";
  clinical_sign_off: { by: string; at: string } | null;
}

/** Signed with a named signer and a date. A draft, or "signed_off" with no signer, is not in force. */
export function envelopeInForce(config: Envelope): boolean {
  return config.status === "signed_off" && config.clinical_sign_off !== null;
}

/** Parse a raw value with a schema; null when it does not parse or is not in force. Never throws. */
export function parseInForce<T extends Envelope>(schema: z.ZodType<T>, raw: unknown): T | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  return envelopeInForce(parsed.data) ? parsed.data : null;
}

/**
 * `in_force` is the only state that lets a feature run. `bundle_unsigned` means the SERVER has a signed version and this build's bundled copy is still
 * an unsigned draft (someone signed and the release was not cut): the feature stays off and this must be reported loudly. `unverified` means the live
 * copy could not be read, and a bundle is not trusted on the strength of its own claim.
 */
export type ConfigTrust = "in_force" | "unsigned" | "invalid" | "drift" | "bundle_unsigned" | "unverified";

/** Pass as `live` when the server was asked and the read failed. Offline (nobody asked) is `undefined`. */
export const LIVE_UNREADABLE = Symbol("live config unreadable");

/** Two signed copies are the same config when everything but the signer's display name and date is equal (a profile rename must not read as drift). */
function sameBody(a: unknown, b: unknown): boolean {
  const strip = (v: unknown) => {
    const o = { ...(v as Record<string, unknown>) };
    delete o.clinical_sign_off;
    return JSON.stringify(sortKeys(o));
  };
  return strip(a) === strip(b);
}

/**
 * Decide which copy of a config a screen may use.
 *   - `live === undefined`: the app is offline or did not ask. The bundled copy is used if it is in force.
 *   - `live === null`: the server was asked and has no signed version. Nothing is in force (a signed bundle with no live signature is drift).
 *   - `live` given: the bundled copy is used only when it is in force and equals the live signed version.
 */
export function resolveBundled<T extends Envelope>(
  schema: z.ZodType<T>,
  bundled: unknown,
  live?: unknown,
): { config: T | null; trust: ConfigTrust } {
  const parsed = schema.safeParse(bundled);
  if (!parsed.success) return { config: null, trust: "invalid" };
  const liveSigned = live !== undefined && live !== null && live !== LIVE_UNREADABLE ? parseInForce(schema, live) : null;
  if (!envelopeInForce(parsed.data)) return { config: null, trust: liveSigned ? "bundle_unsigned" : "unsigned" };
  if (live === undefined) return { config: parsed.data, trust: "in_force" }; // offline: nobody asked
  if (live === LIVE_UNREADABLE) return { config: null, trust: "unverified" };
  if (live === null || !liveSigned) return { config: null, trust: "drift" };
  return sameBody(liveSigned, parsed.data) ? { config: parsed.data, trust: "in_force" } : { config: null, trust: "drift" };
}

/** Key order must not matter when two copies of the same config are compared (jsonb does not keep it). */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();
}
