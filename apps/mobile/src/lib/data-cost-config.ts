import { getProposedConfig } from "@tarragon/shared";

/**
 * S06z values from the versioned registry (packages/shared/src/proposed-config, key offline.data_cost).
 * Call sites take this object and never a literal.
 */
export interface DataCostConfig {
  version: number;
  /** Kobo per megabyte of mobile data. Used only for the estimate the patient sees. */
  pricePerMbKobo: number;
  /** The longest an ordinary entry waits for Wi-Fi, in milliseconds. */
  maxHoldMs: number;
}

/**
 * Today's version, by the registry's dated rules. A phone whose clock runs behind (they do after a power cut) can be dated before the
 * first version took effect; this loader sits on the sync path, so it then takes the highest version rather than throwing.
 */
function resolveEntry(): ReturnType<typeof getProposedConfig<{ readonly [k: string]: number }>> {
  try {
    return getProposedConfig<{ readonly [k: string]: number }>("offline.data_cost");
  } catch {
    return getProposedConfig<{ readonly [k: string]: number }>("offline.data_cost", "9999-12-31");
  }
}

export function loadDataCostConfig(): DataCostConfig {
  const entry = resolveEntry();
  const num = (name: string): number => {
    const n = entry.value[name];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      throw new Error(`offline.data_cost.${name} is not a positive whole number`);
    }
    return n;
  };
  return {
    version: entry.version,
    pricePerMbKobo: num("price_per_mb_kobo"),
    maxHoldMs: num("max_hold_hours") * 3_600_000,
  };
}
