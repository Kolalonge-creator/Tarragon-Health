/**
 * Shape of the PROPOSED maternal configuration (registry key `maternal.rules`, owner CMO, S67). The pure functions in this
 * folder take it as an argument and hold no clinical number of their own: the values live in
 * `packages/shared/src/proposed-config/registry.ts` and nowhere else (a repo scan enforces it). Nothing here is signed.
 */
export interface ContractionRule {
  /** Contractions this many minutes apart or closer (start to start). */
  readonly intervalMinutes: number;
  /** Each lasting at least this many seconds. */
  readonly durationSeconds: number;
  /** For at least this many minutes in a row. */
  readonly sustainedMinutes: number;
}

export interface MaternalConfig {
  readonly antenatal: {
    /** WHO 2016 contact weeks: the first is "by this week", the rest are "at this week". */
    readonly contactWeeks: readonly number[];
  };
  readonly kicks: {
    /** Week from which the movement counter is offered. */
    readonly startWeek: number;
    /** The counting window in minutes. */
    readonly windowMinutes: number;
    /** Movements to feel inside the window. */
    readonly movementsTarget: number;
    /** Finished sessions needed before a personal normal exists. */
    readonly normalMinSessions: number;
    /** How many of the latest finished sessions make up the personal normal. */
    readonly normalLatestSessions: number;
    /** A session that takes this many times the personal normal to reach the target is a clear drop. */
    readonly dropFactor: number;
  };
  readonly contractions: {
    readonly standard: ContractionRule;
    /** For a later birth, a previous fast labour or a long journey (from the birth plan). */
    readonly earlier: ContractionRule;
    /** Contractions before this week are an instant go sign. */
    readonly preTermBeforeWeek: number;
  };
}
