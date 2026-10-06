import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConfigOwner, ConfigValue, ProposedConfigEntry } from "@tarragon/shared";

/**
 * S37: the shapes the go-live guard dashboard and the PROPOSED-config sign-off screen read, and the pure logic that joins the
 * code-side registry (packages/shared/src/proposed-config) to the sign-offs recorded in the database.
 *
 * The database functions return jsonb that the generated types do not describe, so every result is parsed with Zod: a shape
 * change shows up as a calm "could not be loaded" state, never as a silently empty list.
 */

export const GUARD_KEYS = [
  "clinical_operations_enabled",
  "on_call_cover_ok",
  "lab_booking_enabled",
  "prescribing_enabled",
  "scribe_enabled",
  "payouts_enabled",
  "public_signup_enabled",
] as const;
export type GuardKey = (typeof GUARD_KEYS)[number];

/** The guard the consultation flow is wired to (INV-14). */
export const CONSULTATIONS_GUARD: GuardKey = "clinical_operations_enabled";

export const conditionSchema = z.object({
  code: z.string(),
  label: z.string(),
  met: z.boolean(),
  source: z.enum(["data", "attestation", "switch"]),
  detail: z.string().nullable().optional(),
});
export type GuardCondition = z.infer<typeof conditionSchema>;

export const guardSchema = z.object({
  key: z.string(),
  label: z.string(),
  blocks: z.string(),
  condition_text: z.string(),
  switch_role: z.enum(["admin", "cmo"]),
  enforced_in: z.array(z.string()),
  not_enforced_in: z.string(),
  is_on: z.boolean(),
  changed_at: z.string().nullable(),
  changed_by_name: z.string().nullable(),
  change_note: z.string().nullable(),
  conditions: z.array(conditionSchema),
  all_met: z.boolean(),
  recent: z.array(
    z.object({
      action: z.enum(["switched_on", "switched_off"]),
      at: z.string(),
      role: z.enum(["admin", "cmo"]),
      note: z.string().nullable(),
      by: z.string().nullable(),
    }),
  ),
});
export type GuardStatus = z.infer<typeof guardSchema>;
export const guardListSchema = z.array(guardSchema);

export const signoffSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  value_hash: z.string(),
  owner: z.enum(["CMO", "Founder", "Founder and counsel"]),
  decision: z.enum(["confirmed", "changes_requested"]),
  note: z.string().nullable(),
  signed_at: z.string(),
  signed_by_name: z.string().nullable(),
});
export type ConfigSignoff = z.infer<typeof signoffSchema>;
export const signoffListSchema = z.array(signoffSchema);

export type Viewer = "admin" | "cmo";

/** Who may switch a guard ON. Switching OFF is open to both viewers, by design: the stop button is never held up. */
export function viewerMaySwitchOn(guard: Pick<GuardStatus, "switch_role">, viewer: Viewer): boolean {
  return guard.switch_role === viewer;
}

/** A guard that is on while one of its conditions is not met: shown loudly, never switched off automatically. */
export function guardHasDrifted(guard: Pick<GuardStatus, "is_on" | "all_met">): boolean {
  return guard.is_on && !guard.all_met;
}

/** Which owner a viewer confirms for. The founder is the admin account. */
export function viewerOwns(owner: ConfigOwner, viewer: Viewer): boolean {
  return viewer === "cmo" ? owner === "CMO" : owner === "Founder" || owner === "Founder and counsel";
}

function stable(value: ConfigValue): string {
  if (Array.isArray(value)) return `[${value.map((v) => stable(v as ConfigValue)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as { readonly [k: string]: ConfigValue };
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k] as ConfigValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * sha-256 of the value as it stands in the registry, with object keys sorted so the same value always hashes the same.
 * A sign-off stores this hash: edit the value later and the old sign-off no longer counts (the row shows "changed since").
 */
export function hashConfigValue(value: ConfigValue): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export type ConfigRowStatus = "awaiting" | "signed" | "changes_requested" | "stale" | "confirmed_in_registry";

export interface ConfigRow {
  readonly key: string;
  readonly version: number;
  readonly owner: ConfigOwner;
  readonly valueText: string;
  readonly valueHash: string;
  readonly source: string;
  readonly registryStatus: ProposedConfigEntry["status"];
  readonly status: ConfigRowStatus;
  readonly signoff: ConfigSignoff | null;
}

/**
 * One row per key: the version in force (the highest version effective today). Registry status "confirmed" already means the
 * owner published a confirmed entry, so it needs no sign-off. Otherwise the newest recorded decision decides: confirmed against
 * the SAME hash is signed; confirmed against a different hash is stale; a change request stays a change request.
 */
export function buildConfigRows(
  entries: readonly ProposedConfigEntry[],
  signoffs: readonly ConfigSignoff[],
  asOf: string,
): ConfigRow[] {
  const latest = new Map<string, ProposedConfigEntry>();
  for (const e of entries) {
    if (e.effectiveFrom > asOf) continue;
    const have = latest.get(e.key);
    if (!have || e.version > have.version) latest.set(e.key, e);
  }
  return [...latest.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e) => {
      const hash = hashConfigValue(e.value);
      const signoff = signoffs.find((s) => s.key === e.key && s.version === e.version) ?? null;
      let status: ConfigRowStatus;
      if (e.status === "confirmed") status = "confirmed_in_registry";
      else if (!signoff) status = "awaiting";
      else if (signoff.decision === "changes_requested") status = "changes_requested";
      else status = signoff.value_hash === hash ? "signed" : "stale";
      return { key: e.key, version: e.version, owner: e.owner, valueText: stable(e.value), valueHash: hash, source: e.source, registryStatus: e.status, status, signoff };
    });
}

/** Rows still waiting on their owner (anything that is not confirmed in the registry or signed against the current value). */
export function openRows(rows: readonly ConfigRow[]): ConfigRow[] {
  return rows.filter((r) => r.status !== "signed" && r.status !== "confirmed_in_registry");
}

/** Server-side lookup for the sign-off action: the entry the person is confirming, from the registry and never from the client. */
export function findEntry(entries: readonly ProposedConfigEntry[], key: string, version: number): ProposedConfigEntry | null {
  return entries.find((e) => e.key === key && e.version === version) ?? null;
}
