import { getProposedConfig } from "@tarragon/shared";
import type { MaternalConfig } from "@tarragon/clinical";

/**
 * The PROPOSED maternal values (registry key `maternal.rules`, owner CMO, S67), read once for the web screens. Nothing here is signed.
 * The version is recorded beside every saved session (INV-16). Mirrors apps/mobile/src/lib/maternal-config.ts.
 */
export interface LoadedMaternalConfig {
  version: number;
  config: MaternalConfig;
}

export function loadMaternalConfig(asOf?: string): LoadedMaternalConfig {
  const entry = getProposedConfig("maternal.rules", asOf);
  const v = entry.value as unknown as Partial<MaternalConfig> | null;
  if (!v?.antenatal || !v.kicks || !v.contractions) throw new Error("Config maternal.rules is malformed");
  return { version: entry.version, config: v as MaternalConfig };
}
