import { getProposedConfig } from "@tarragon/shared";
import type { MaternalConfig } from "@tarragon/clinical";

/**
 * The PROPOSED maternal values (registry key `maternal.rules`, owner CMO, S67), checked once. Nothing here is signed; the phone
 * uses them to decide the kick and contraction cards offline, and records the config version beside every session (INV-16).
 */
export interface LoadedMaternalConfig {
  version: number;
  config: MaternalConfig;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function rule(v: unknown): boolean {
  const r = v as Record<string, unknown> | null;
  return !!r && isNum(r.intervalMinutes) && isNum(r.durationSeconds) && isNum(r.sustainedMinutes);
}

export function loadMaternalConfig(asOf?: string): LoadedMaternalConfig {
  const entry = getProposedConfig("maternal.rules", asOf);
  const v = entry.value as unknown as Partial<MaternalConfig> | null;
  const weeks = v?.antenatal?.contactWeeks;
  const k = v?.kicks as Record<string, unknown> | undefined;
  const c = v?.contractions as Record<string, unknown> | undefined;
  const ok =
    Array.isArray(weeks) && weeks.length > 0 && weeks.every(isNum) &&
    !!k && ["startWeek", "windowMinutes", "movementsTarget", "normalMinSessions", "normalLatestSessions", "dropFactor"].every((n) => isNum(k[n])) &&
    !!c && rule(c.standard) && rule(c.earlier) && isNum(c.preTermBeforeWeek);
  if (!ok) throw new Error("Config maternal.rules is malformed");
  return { version: entry.version, config: v as MaternalConfig };
}
