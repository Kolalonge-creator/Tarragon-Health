/**
 * Continuous glucose monitor sustained-event rules (S70a, function 18.5, decision S70-2). Pure mirror of the database evaluator
 * (private.evaluate_cgm_sustained), used on the phone to show the severe-low safety message at once, offline, before any server round trip
 * (INV-06). The server creates the clinician task; this module only decides what the screen shows. Deterministic, no model (INV-01).
 * Every number comes from the PROPOSED configuration `devices.cgm_events`; none is hard-coded here and none is signed.
 */
import { getProposedConfig } from "./proposed-config";

export interface CgmRule {
  code: "low_severe" | "low" | "high";
  kind: "low" | "high";
  below_mmol_l?: number;
  above_mmol_l?: number;
  minutes: number;
  due_minutes: number;
  cooldown_minutes: number;
}
export interface CgmEventsConfig {
  rules: CgmRule[];
  max_gap_minutes: number;
  task_type: string;
  severe_low_copy: string;
}
export interface CgmSample {
  takenAt: string;
  mmolL: number;
}

export function loadCgmEventsConfig(asOf?: string): { config: CgmEventsConfig; version: number } {
  const r = getProposedConfig("devices.cgm_events", asOf);
  return { config: r.value as unknown as CgmEventsConfig, version: r.version };
}

const meets = (rule: CgmRule, v: number): boolean =>
  rule.kind === "low" ? v < (rule.below_mmol_l as number) : v > (rule.above_mmol_l as number);

/**
 * Which rules the stream satisfies as of its latest sample: every sample in the trailing run is beyond the line, the run is at least
 * `minutes` long, and no gap inside the run is longer than max_gap_minutes (a sensor that went quiet proves nothing). Rules are returned
 * most serious first, so a caller that shows one message shows the first.
 */
export function evaluateCgmSustained(samples: readonly CgmSample[], loaded = loadCgmEventsConfig()): CgmRule[] {
  const { config } = loaded;
  const sorted = [...samples].filter((s) => Number.isFinite(Date.parse(s.takenAt))).sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const last = sorted[sorted.length - 1];
  if (!last) return [];
  const fired: CgmRule[] = [];
  for (const rule of config.rules) {
    if (!meets(rule, last.mmolL)) continue;
    let runStart = Date.parse(last.takenAt);
    let prev = runStart;
    let ok = true;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const s = sorted[i] as CgmSample;
      if (!meets(rule, s.mmolL)) break;
      const t = Date.parse(s.takenAt);
      if (prev - t > config.max_gap_minutes * 60_000) {
        ok = false;
        break;
      }
      runStart = t;
      prev = t;
    }
    if (ok && Date.parse(last.takenAt) - runStart >= rule.minutes * 60_000) fired.push(rule);
  }
  return fired;
}

/** The text the screen shows at once for a sustained severe low, or null when it does not apply. */
export function severeLowMessage(samples: readonly CgmSample[], loaded = loadCgmEventsConfig()): string | null {
  return evaluateCgmSustained(samples, loaded).some((r) => r.code === "low_severe") ? loaded.config.severe_low_copy : null;
}
