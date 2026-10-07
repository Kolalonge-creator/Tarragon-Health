import type { ContractionRule, MaternalConfig } from "./config";

/**
 * Contraction timer (spec 16.7, CMO selection A4). Pure. The default pattern is 5-1-1 (every 5 minutes or closer, each lasting
 * a minute, for an hour); a later birth, a previous fast labour or a long journey (read from the birth plan) use the earlier
 * pattern. Some signs mean "go now" with no timing at all. The answer is always "go" or "keep timing": never "wait".
 */
export type InstantGoSign = "waters_break" | "vaginal_bleeding" | "reduced_fetal_movement" | "fit" | "severe_headache";
export const INSTANT_GO_SIGNS: readonly InstantGoSign[] = ["waters_break", "vaginal_bleeding", "reduced_fetal_movement", "fit", "severe_headache"];

export interface Contraction {
  readonly startMs: number;
  /** Null while it is still happening. */
  readonly endMs: number | null;
}

export interface BirthPlanFlags {
  readonly longJourney: boolean;
  readonly previousFastLabour: boolean;
  /** Births she has already had. A later birth is one or more. */
  readonly previousBirths: number;
}

export type ContractionState = "keep_timing" | "go_now";
export type GoReason = "instant_sign" | "before_term" | "pattern";

export interface ContractionEvaluation {
  readonly state: ContractionState;
  readonly reason: GoReason | null;
  readonly pattern: "standard" | "earlier";
  /** True when the week is not known and the before-37-weeks check could not be made: the screen asks for the due date. */
  readonly needsGestation: boolean;
  /** Start to start gaps of the latest contractions, in minutes, for display. */
  readonly gapsMinutes: readonly number[];
}

export function patternFor(flags: BirthPlanFlags | null): "standard" | "earlier" {
  if (!flags) return "standard";
  return flags.longJourney || flags.previousFastLabour || flags.previousBirths >= 1 ? "earlier" : "standard";
}

function ruleFor(pattern: "standard" | "earlier", config: MaternalConfig): ContractionRule {
  return pattern === "earlier" ? config.contractions.earlier : config.contractions.standard;
}

export function evaluateContractions(
  contractions: readonly Contraction[],
  ctx: { week: number | null; signs: readonly InstantGoSign[]; flags: BirthPlanFlags | null },
  nowMs: number,
  config: MaternalConfig,
): ContractionEvaluation {
  const pattern = patternFor(ctx.flags);
  const rule = ruleFor(pattern, config);
  const sorted = [...contractions].sort((a, b) => a.startMs - b.startMs);
  const gapsMinutes = sorted.slice(1).map((c, i) => Math.round(((c.startMs - sorted[i]!.startMs) / 60_000) * 10) / 10).slice(-8);
  const base = { pattern, gapsMinutes };

  if (ctx.signs.length > 0) return { ...base, state: "go_now", reason: "instant_sign", needsGestation: false };

  const needsGestation = ctx.week === null;
  if (ctx.week !== null && ctx.week < config.contractions.preTermBeforeWeek && sorted.length > 0) {
    return { ...base, state: "go_now", reason: "before_term", needsGestation: false };
  }

  // The latest unbroken run: walk back from the newest contraction while each starts within the interval of the next and lasts long enough.
  const longEnough = (c: Contraction): boolean => (c.endMs ?? nowMs) - c.startMs >= rule.durationSeconds * 1000;
  const intervalMs = rule.intervalMinutes * 60_000;
  const last = sorted[sorted.length - 1];
  if (last && longEnough(last)) {
    let first = last;
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
      const c = sorted[i]!;
      if (first.startMs - c.startMs > intervalMs || !longEnough(c)) break;
      first = c;
    }
    const spanMs = (last.endMs ?? nowMs) - first.startMs;
    if (spanMs >= rule.sustainedMinutes * 60_000) return { ...base, state: "go_now", reason: "pattern", needsGestation };
  }
  return { ...base, state: "keep_timing", reason: null, needsGestation };
}
