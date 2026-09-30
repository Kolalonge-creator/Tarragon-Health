import {
  PROPOSED_CONFIG,
  type ConfigStatus,
  type ConfigValue,
  type ProposedConfigEntry,
} from "./registry";

export { PROPOSED_CONFIG };
export type { ConfigOwner, ConfigStatus, ConfigValue, ProposedConfigEntry } from "./registry";

export interface ResolvedConfig<T extends ConfigValue = ConfigValue> {
  readonly key: string;
  readonly value: T;
  readonly version: number;
  readonly status: ConfigStatus;
  readonly owner: ProposedConfigEntry["owner"];
  readonly effectiveFrom: string;
}

export class UnknownConfigKeyError extends Error {
  constructor(key: string) {
    super(`No versioned configuration for key "${key}"`);
    this.name = "UnknownConfigKeyError";
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Resolve the entry in force for `key` on `asOf` (default today): the highest
 * version whose `effectiveFrom` is on or before that date. Returning the
 * version lets a caller record which one it used (INV-16). Throws on an unknown
 * key so a typo cannot silently become "no limit".
 */
export function getProposedConfig<T extends ConfigValue = ConfigValue>(
  key: string,
  asOf: string = today(),
  entries: readonly ProposedConfigEntry[] = PROPOSED_CONFIG,
): ResolvedConfig<T> {
  const candidates = entries
    .filter((e) => e.key === key && e.effectiveFrom <= asOf)
    .sort((a, b) => b.version - a.version);
  const hit = candidates[0];
  if (!hit) throw new UnknownConfigKeyError(key);
  return {
    key: hit.key,
    value: hit.value as T,
    version: hit.version,
    status: hit.status,
    owner: hit.owner,
    effectiveFrom: hit.effectiveFrom,
  };
}

/** Keys still awaiting confirmation by their owner (for the go-live guards dashboard). */
export function listUnconfirmed(
  asOf: string = today(),
  entries: readonly ProposedConfigEntry[] = PROPOSED_CONFIG,
): ResolvedConfig[] {
  const keys = [...new Set(entries.map((e) => e.key))];
  return keys
    .map((k) => getProposedConfig(k, asOf, entries))
    .filter((r) => r.status === "proposed");
}

/** Structural validation of a registry. Returns a list of problems (empty when valid). */
export function validateRegistry(entries: readonly ProposedConfigEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const byKey = new Map<string, ProposedConfigEntry[]>();
  for (const e of entries) {
    const id = `${e.key}@v${e.version}`;
    if (seen.has(id)) problems.push(`duplicate entry ${id}`);
    seen.add(id);
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(e.key)) problems.push(`bad key format: ${e.key}`);
    if (!Number.isInteger(e.version) || e.version < 1) problems.push(`${id}: version must be an integer >= 1`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.effectiveFrom)) problems.push(`${id}: effectiveFrom must be YYYY-MM-DD`);
    if (!e.source.trim()) problems.push(`${id}: source is required`);
    if (e.key.endsWith("_kobo") && e.value !== null && !Number.isInteger(e.value)) {
      problems.push(`${id}: *_kobo must be an integer (INV-15)`);
    }
    byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  }
  for (const [key, list] of byKey) {
    const versions = list.map((e) => e.version).sort((a, b) => a - b);
    versions.forEach((v, i) => {
      if (v !== i + 1) problems.push(`${key}: versions must run 1..n without gaps (got ${versions.join(",")})`);
    });
  }
  return problems;
}
