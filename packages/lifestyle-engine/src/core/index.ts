/**
 * Engine core — pure programme mechanics (spec §6, §7). No I/O.
 *
 *  - buildInstantiationPlan: template graph → the instance rows to create
 *  - nextPhase: which phase follows the current one
 *  - evaluateStreak: KIND streak logic — a miss never "fails" a patient
 *
 * All functions are side-effect-free so they unit-test without a DB and run
 * identically in route handlers, jobs, and the doctor console.
 */
import type { Module, PhaseKind } from "../types/index";

// ---------------------------------------------------------------------------
// Instantiation (spec §7)
// ---------------------------------------------------------------------------

export interface PhaseTemplateNode {
  id: string;
  key: string;
  orderIndex: number;
  kind: PhaseKind;
  durationDaysMin: number | null;
  durationDaysMax: number | null;
  autoAdvance: boolean;
  goals: GoalTemplateNode[];
}

export interface GoalTemplateNode {
  id: string;
  module: Module;
  title: string;
  metricKey: string | null;
  target: unknown;
}

export interface InstantiationInput {
  phases: PhaseTemplateNode[];
  /** ISO date the programme starts (defaults to now at call site). */
  startedAt: string;
}

export interface PlannedPhaseInstance {
  phaseTemplateId: string;
  key: string;
  status: "active" | "pending";
  startedAt: string | null;
  targetEndAt: string | null;
}

export interface PlannedGoalInstance {
  goalTemplateId: string;
  module: Module;
  title: string;
  metricKey: string | null;
  target: unknown;
}

export interface InstantiationPlan {
  phases: PlannedPhaseInstance[];
  /** Goals for the FIRST phase only — later phases instantiate on advance. */
  firstPhaseGoals: PlannedGoalInstance[];
  currentPhaseKey: string | null;
}

/**
 * Turn a template graph into the concrete rows to create on enrolment. Only the
 * first phase starts active (with a target end date from its max duration);
 * the rest are pending. Goals are instantiated for the first phase only.
 */
export function buildInstantiationPlan(input: InstantiationInput): InstantiationPlan {
  const ordered = [...input.phases].sort((a, b) => a.orderIndex - b.orderIndex);
  const first = ordered[0];

  const phases: PlannedPhaseInstance[] = ordered.map((p, i) => {
    const isFirst = i === 0;
    return {
      phaseTemplateId: p.id,
      key: p.key,
      status: isFirst ? "active" : "pending",
      startedAt: isFirst ? input.startedAt : null,
      targetEndAt:
        isFirst && p.durationDaysMax !== null
          ? addDaysIso(input.startedAt, p.durationDaysMax)
          : null,
    };
  });

  const firstPhaseGoals: PlannedGoalInstance[] = (first?.goals ?? []).map((g) => ({
    goalTemplateId: g.id,
    module: g.module,
    title: g.title,
    metricKey: g.metricKey,
    target: g.target,
  }));

  return { phases, firstPhaseGoals, currentPhaseKey: first?.key ?? null };
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Phase advance (spec §6)
// ---------------------------------------------------------------------------

/** The phase that follows `currentKey`, or null if the current one is last. */
export function nextPhase(
  phases: Pick<PhaseTemplateNode, "key" | "orderIndex">[],
  currentKey: string,
): { key: string } | null {
  const ordered = [...phases].sort((a, b) => a.orderIndex - b.orderIndex);
  const idx = ordered.findIndex((p) => p.key === currentKey);
  if (idx < 0 || idx === ordered.length - 1) return null;
  const next = ordered[idx + 1];
  return next ? { key: next.key } : null;
}

// ---------------------------------------------------------------------------
// Kind streaks (spec §7) — a miss is NEVER a failure.
// ---------------------------------------------------------------------------

export interface StreakResult {
  /** Consecutive completed tasks up to the most recent (0+). */
  currentStreak: number;
  /** Consecutive missed tasks up to the most recent (0+). */
  recentMisses: number;
  /** After 1 miss: a gentle nudge (never a red/failure UI). */
  shouldNudge: boolean;
  /** After `missThreshold` misses: surface a supportive doctor/coach task. */
  shouldRaiseWorklistItem: boolean;
}

/**
 * @param outcomes most-recent-first list of task outcomes.
 * @param missThreshold misses before a worklist item is raised (default 3).
 */
export function evaluateStreak(
  outcomes: ("done" | "missed" | "skipped")[],
  missThreshold = 3,
): StreakResult {
  let currentStreak = 0;
  for (const o of outcomes) {
    if (o === "done") currentStreak++;
    else if (o === "missed") break;
    // 'skipped' is neutral — neither breaks nor extends a streak (kind).
  }

  let recentMisses = 0;
  for (const o of outcomes) {
    if (o === "missed") recentMisses++;
    else if (o === "done") break;
  }

  return {
    currentStreak,
    recentMisses,
    shouldNudge: recentMisses >= 1,
    shouldRaiseWorklistItem: recentMisses >= missThreshold,
  };
}
