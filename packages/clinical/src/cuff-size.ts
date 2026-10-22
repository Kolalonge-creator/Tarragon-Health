/**
 * Cuff size from arm circumference (S07y). Pure; the ranges come from the governed `bp_cuff_guidance_signoffs` row (mirrored as the PROPOSED config
 * `bp.cuff_sizing`), never from this file. It is a lookup, not a diagnosis, and it never grades a blood pressure.
 * The SQL twin is `private.bp_cuff_size_key`; both look up the whole centimetre, rounding half up, and a parity block in the database proof and in
 * cuff-size.test.ts pins them to the same cases.
 */
export interface CuffSizeBand {
  key: string;
  minCm: number;
  maxCm: number;
}

export interface CuffSizingConfig {
  sizes: readonly CuffSizeBand[];
  measureMinCm: number;
  measureMaxCm: number;
}

export type CuffSizeKey = string;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export function parseCuffSizingConfig(value: unknown): CuffSizingConfig {
  if (!isRecord(value) || !Array.isArray(value["sizes"]) || value["sizes"].length === 0) throw new Error("cuff sizing config needs a list of sizes");
  const sizes = value["sizes"].map((s, i): CuffSizeBand => {
    if (!isRecord(s) || typeof s["key"] !== "string" || typeof s["minCm"] !== "number" || typeof s["maxCm"] !== "number" || s["minCm"] > s["maxCm"]) {
      throw new Error(`cuff sizing config: size ${i} is not valid`);
    }
    return { key: s["key"], minCm: s["minCm"], maxCm: s["maxCm"] };
  });
  const min = value["measureMinCm"];
  const max = value["measureMaxCm"];
  if (typeof min !== "number" || typeof max !== "number" || min >= max) throw new Error("cuff sizing config needs measureMinCm below measureMaxCm");
  return { sizes, measureMinCm: min, measureMaxCm: max };
}

/** Math.round rounds half up for positive numbers, matching SQL round() on numeric. */
export function cuffSizeKey(armCm: number, cfg: CuffSizingConfig): CuffSizeKey | "below_range" | "above_range" {
  const cm = Math.round(armCm);
  const hit = cfg.sizes.find((s) => cm >= s.minCm && cm <= s.maxCm);
  if (hit) return hit.key;
  return cm < Math.min(...cfg.sizes.map((s) => s.minCm)) ? "below_range" : "above_range";
}

/** Whether a typed arm measurement is plausible enough to look up at all (the server refuses the same values). */
export function isPlausibleArmCm(armCm: number, cfg: CuffSizingConfig): boolean {
  return Number.isFinite(armCm) && armCm >= cfg.measureMinCm && armCm <= cfg.measureMaxCm;
}
