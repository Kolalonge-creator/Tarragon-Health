/**
 * S47b (BUILD-SPEC-v5 4.1, 4.5): `today-build`, which picks the cards the Today screen shows and enforces the acceptance test "the Today screen never shows
 * more than two primary actions".
 *
 * Pure and deterministic: no clock, no network, no copy, no language model. The phone runs it; the server runs the same function behind
 * `/api/mobile/today-build` when the phone cannot. Every number comes from the versioned configuration `today.home_cards` (database row
 * `home_card_config`, UNSIGNED and INACTIVE until the Chief Medical Officer signs it), never from this file, except one hard limit that no
 * configuration can raise: MAX_PRIMARY_ACTIONS.
 *
 * Rules:
 *  - A card is shown only when the facts for it exist and its rules match the person (goals, pathways, a device when the card needs one). An unknown is a
 *    no: a card is hidden, never guessed.
 *  - A card is a PRIMARY action only when it is `primary_eligible`, there is something to do now, and it ranks in the first `max_primary_actions`
 *    (never more than MAX_PRIMARY_ACTIONS). Everything else that is shown is secondary and collapsed by the screen.
 *  - Ranking is by when something is due and the configured priority, never by how the person is doing. The one override: a task that is overdue
 *    comes first.
 *  - Nothing here grades a reading, a streak or a week.
 */

/** The hard ceiling. A configuration that asks for more is refused when it is read, and the result is clamped again in case one slips through. */
export const MAX_PRIMARY_ACTIONS = 2;

export const HOME_CARD_CODES = [
  "task_due",
  "medicines",
  "readings",
  "goal",
  "lesson",
  "assistant_nudge",
  "streak",
  "weekly_summary",
  "readiness",
] as const;
export type HomeCardCode = (typeof HOME_CARD_CODES)[number];

/** Cards that can ask the person to do something. The others only show information and are always secondary. */
const ACTION_CODES: readonly HomeCardCode[] = ["task_due", "medicines", "readings", "goal", "lesson", "assistant_nudge"];

export interface HomeCardRules {
  /** Empty means every goal. Otherwise the person must hold at least one of these goals. */
  readonly goalsAny: readonly string[];
  /** Empty means every pathway. Otherwise the person must be on at least one of these pathways. */
  readonly pathwaysAny: readonly string[];
  readonly requiresDevice: boolean;
}

export interface HomeCardDef {
  readonly code: HomeCardCode;
  /** Lower comes first. */
  readonly priority: number;
  readonly primaryEligible: boolean;
  readonly rules: HomeCardRules;
}

export interface HomeCardConfig {
  readonly version: number;
  readonly maxPrimaryActions: number;
  readonly cards: readonly HomeCardDef[];
  readonly streakEnabled: boolean;
}

export class HomeCardConfigError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.trim() === "")) throw new HomeCardConfigError(`${what} must be a list of words`);
  return v as string[];
}

/** Reads the configuration, or throws. Mirrors `private.home_card_config_valid` so a configuration the app would refuse can never be signed. */
export function parseHomeCardConfig(version: number, value: unknown): HomeCardConfig {
  if (!isObj(value)) throw new HomeCardConfigError("the home card configuration must be an object");
  const max = value["max_primary_actions"];
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > MAX_PRIMARY_ACTIONS) {
    throw new HomeCardConfigError(`max_primary_actions must be a whole number from 1 to ${MAX_PRIMARY_ACTIONS}`);
  }
  const rawCards = value["cards"];
  if (!Array.isArray(rawCards) || rawCards.length === 0) throw new HomeCardConfigError("cards must be a non-empty list");
  const seen = new Set<string>();
  const cards: HomeCardDef[] = rawCards.map((c: unknown) => {
    if (!isObj(c)) throw new HomeCardConfigError("every card must be an object");
    const code = c["code"];
    if (typeof code !== "string" || !(HOME_CARD_CODES as readonly string[]).includes(code)) throw new HomeCardConfigError(`unknown card code ${String(code)}`);
    if (seen.has(code)) throw new HomeCardConfigError(`card ${code} appears twice`);
    seen.add(code);
    const priority = c["priority"];
    if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0) throw new HomeCardConfigError(`card ${code}: priority must be a whole number`);
    const primaryEligible = c["primary_eligible"];
    if (typeof primaryEligible !== "boolean") throw new HomeCardConfigError(`card ${code}: primary_eligible must be true or false`);
    if (primaryEligible && !(ACTION_CODES as readonly string[]).includes(code)) throw new HomeCardConfigError(`card ${code} only shows information, so it cannot be a primary action`);
    const rules = c["rules"];
    if (!isObj(rules)) throw new HomeCardConfigError(`card ${code}: rules must be an object`);
    if (typeof rules["requires_device"] !== "boolean") throw new HomeCardConfigError(`card ${code}: requires_device must be true or false`);
    return {
      code: code as HomeCardCode,
      priority,
      primaryEligible,
      rules: {
        goalsAny: strings(rules["goals_any"], `card ${code}: goals_any`),
        pathwaysAny: strings(rules["pathways_any"], `card ${code}: pathways_any`),
        requiresDevice: rules["requires_device"],
      },
    };
  });
  const streak = value["streak"];
  if (!isObj(streak) || typeof streak["enabled"] !== "boolean") throw new HomeCardConfigError("streak.enabled must be true or false");
  return { version, maxPrimaryActions: max, cards, streakEnabled: streak["enabled"] };
}

/**
 * What the screen knows today. A slot the screen could not read is `null`, which hides its card: a card is never shown on a guess. Counts are of
 * things, never of readings' values, so nothing here can leak a result.
 */
export interface TodayFacts {
  readonly goals: readonly string[];
  readonly pathways: readonly string[];
  readonly hasDevice: boolean;
  /** Open tasks from the care team and how many of them are overdue. */
  readonly task: { readonly openCount: number; readonly overdueCount: number } | null;
  /** Doses still waiting today. */
  readonly medicines: { readonly pendingCount: number } | null;
  /** Whether a reading has been logged today. */
  readonly readings: { readonly loggedToday: boolean } | null;
  /** The one small goal for the day, when there is one. */
  readonly goal: { readonly metToday: boolean } | null;
  readonly lesson: { readonly available: boolean } | null;
  readonly assistantNudge: { readonly available: boolean } | null;
  readonly streak: { readonly available: boolean } | null;
  readonly weekly: { readonly available: boolean } | null;
  readonly readiness: { readonly available: boolean } | null;
}

/**
 * action: there is something to do now. done: the thing is finished for today (shown calmly, secondary). info: a card that only informs.
 */
export type HomeCardState = "action" | "done" | "info";

export interface HomeCardPick {
  readonly code: HomeCardCode;
  readonly state: HomeCardState;
  /** True only for a task that is overdue. */
  readonly urgent: boolean;
}

export interface TodayPlan {
  readonly configVersion: number;
  /** At most MAX_PRIMARY_ACTIONS. Every one has state "action". */
  readonly primary: readonly HomeCardPick[];
  /** Everything else that is shown. The screen keeps these collapsed. */
  readonly secondary: readonly HomeCardPick[];
  /** Cards switched off for this person or with nothing to show. */
  readonly hidden: readonly HomeCardCode[];
}

function rulesMatch(rules: HomeCardRules, facts: TodayFacts): boolean {
  if (rules.requiresDevice && !facts.hasDevice) return false;
  if (rules.goalsAny.length > 0 && !rules.goalsAny.some((g) => facts.goals.includes(g))) return false;
  if (rules.pathwaysAny.length > 0 && !rules.pathwaysAny.some((p) => facts.pathways.includes(p))) return false;
  return true;
}

/** The state of a card for these facts, or null when it has nothing to show. */
function stateFor(code: HomeCardCode, facts: TodayFacts): { state: HomeCardState; urgent: boolean } | null {
  switch (code) {
    case "task_due":
      if (!facts.task || facts.task.openCount <= 0) return null;
      return { state: "action", urgent: facts.task.overdueCount > 0 };
    case "medicines":
      if (!facts.medicines) return null;
      return { state: facts.medicines.pendingCount > 0 ? "action" : "done", urgent: false };
    case "readings":
      if (!facts.readings) return null;
      return { state: facts.readings.loggedToday ? "done" : "action", urgent: false };
    case "goal":
      if (!facts.goal) return null;
      return { state: facts.goal.metToday ? "done" : "action", urgent: false };
    case "lesson":
      return facts.lesson?.available ? { state: "action", urgent: false } : null;
    case "assistant_nudge":
      return facts.assistantNudge?.available ? { state: "action", urgent: false } : null;
    case "streak":
      return facts.streak?.available ? { state: "info", urgent: false } : null;
    case "weekly_summary":
      return facts.weekly?.available ? { state: "info", urgent: false } : null;
    case "readiness":
      return facts.readiness?.available ? { state: "info", urgent: false } : null;
  }
}

export function buildToday(config: HomeCardConfig, facts: TodayFacts): TodayPlan {
  const picks: { pick: HomeCardPick; def: HomeCardDef }[] = [];
  const hidden: HomeCardCode[] = [];
  for (const def of config.cards) {
    const state = rulesMatch(def.rules, facts) ? stateFor(def.code, facts) : null;
    if (def.code === "streak" && !config.streakEnabled) {
      hidden.push(def.code);
      continue;
    }
    if (!state) {
      hidden.push(def.code);
      continue;
    }
    picks.push({ pick: { code: def.code, state: state.state, urgent: state.urgent }, def });
  }

  const order = (a: { pick: HomeCardPick; def: HomeCardDef }, b: { pick: HomeCardPick; def: HomeCardDef }) =>
    Number(b.pick.urgent) - Number(a.pick.urgent) || a.def.priority - b.def.priority || a.def.code.localeCompare(b.def.code);
  picks.sort(order);

  const limit = Math.min(config.maxPrimaryActions, MAX_PRIMARY_ACTIONS);
  const primary: HomeCardPick[] = [];
  const secondary: HomeCardPick[] = [];
  for (const { pick, def } of picks) {
    if (def.primaryEligible && pick.state === "action" && primary.length < limit) primary.push(pick);
    else secondary.push(pick);
  }
  return { configVersion: config.version, primary, secondary, hidden };
}
