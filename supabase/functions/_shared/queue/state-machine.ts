// S16: the clinical task state machine and the small calculations around it (spec 7.3, 7.4).
//
// Pure: no clock, no database. The database is the enforcer (private.apply_task_transition and the guard
// trigger); this file is the same rules for code that has to decide before it asks, such as a screen that
// hides a button. A test compares TRANSITIONS with the migration's rule table so the two cannot drift.

export const TASK_STATES = ["created", "offered_to_lead", "open", "claimed", "completed", "escalated", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const ACTOR_KINDS = ["system", "clinician", "lead"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface Transition {
  readonly from: TaskState;
  readonly to: TaskState;
  readonly actor: ActorKind;
}

export const TRANSITIONS: readonly Transition[] = [
  { from: "created", to: "offered_to_lead", actor: "system" },
  { from: "created", to: "open", actor: "system" },
  { from: "offered_to_lead", to: "open", actor: "system" },
  { from: "offered_to_lead", to: "claimed", actor: "clinician" },
  { from: "offered_to_lead", to: "escalated", actor: "system" },
  { from: "open", to: "claimed", actor: "clinician" },
  { from: "open", to: "escalated", actor: "system" },
  { from: "escalated", to: "claimed", actor: "clinician" },
  { from: "claimed", to: "completed", actor: "clinician" },
  { from: "claimed", to: "open", actor: "clinician" },
  { from: "claimed", to: "open", actor: "system" },
  { from: "created", to: "cancelled", actor: "lead" },
  { from: "offered_to_lead", to: "cancelled", actor: "lead" },
  { from: "open", to: "cancelled", actor: "lead" },
  { from: "claimed", to: "cancelled", actor: "lead" },
  { from: "escalated", to: "cancelled", actor: "lead" },
];

export const TERMINAL_STATES: readonly TaskState[] = ["completed", "cancelled"];

export function canTransition(from: TaskState, to: TaskState, actor: ActorKind): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor);
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** The moves an actor may make from a state, for showing only the buttons that can work. */
export function movesFor(from: TaskState, actor: ActorKind): TaskState[] {
  return TRANSITIONS.filter((t) => t.from === from && t.actor === actor).map((t) => t.to);
}

export const DOCTOR_TIER_RANK = {
  care_coordinator: 0,
  senior_medical_officer: 2,
  chief_medical_officer: 3,
} as const;
export type DoctorTier = keyof typeof DOCTOR_TIER_RANK;

/** The minimum-tier gate. Doctor tier is the only gate (founder, 2026-10-06); credentialing level is not used. */
export function meetsMinimumTier(have: DoctorTier, need: DoctorTier): boolean {
  return DOCTOR_TIER_RANK[have] >= DOCTOR_TIER_RANK[need];
}

const MINUTE_MS = 60_000;

export function dueAt(nowMs: number, dueMinutes: number | null | undefined, defaultDueMinutes: number): number {
  return nowMs + (dueMinutes ?? defaultDueMinutes) * MINUTE_MS;
}

/** A named clinician's window to take a task before it goes to the pool; never past the due time, none for a red-class task (INV-05). */
export function offerWindowEnd(nowMs: number, due: number, windowMinutes: number, priorityClass: number): number | null {
  if (priorityClass === 1 || windowMinutes <= 0) return null;
  return Math.min(due, nowMs + windowMinutes * MINUTE_MS);
}

export function claimExpiry(nowMs: number, timeoutMinutes: number): number {
  return nowMs + timeoutMinutes * MINUTE_MS;
}

export interface PromotionInput {
  readonly type: string;
  readonly priorityClass: number;
  readonly originalClass: number;
  readonly state: TaskState;
  readonly due: number;
  readonly nowMs: number;
  readonly windowMinutes: number;
}

/** An amber review within the window of its due time moves up to class 3, once (spec 7.3). Returns the class it should have. */
export function classAfterPromotion(t: PromotionInput): number {
  const live = t.state === "offered_to_lead" || t.state === "open" || t.state === "claimed";
  const untouched = t.priorityClass === 4 && t.originalClass === 4;
  if (t.type === "amber_bp_review" && untouched && live && t.due <= t.nowMs + t.windowMinutes * MINUTE_MS) return 3;
  return t.priorityClass;
}

/** A task past its due time that nobody holds should be escalated (S19 pages). */
export function shouldEscalate(state: TaskState, due: number, nowMs: number): boolean {
  return (state === "offered_to_lead" || state === "open") && due <= nowMs;
}

/** An offer to a named clinician lapses when its window ends. */
export function offerLapsed(state: TaskState, windowEnd: number | null, nowMs: number): boolean {
  return state === "offered_to_lead" && windowEnd !== null && windowEnd <= nowMs;
}
