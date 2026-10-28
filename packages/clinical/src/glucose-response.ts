/**
 * Personal glucose-response insights (S50b, spec 6.11).
 *
 * Pairs each logged meal with the glucose reading just before it and the one about two hours after it, and summarises the pairs per food as RANGES AND
 * SAMPLE COUNTS. It never ranks a food, never calls one good or bad, never says a food caused a change, and shows nothing for a group with fewer pairs
 * than the configured minimum. It is what the person logged, not a diagnosis.
 *
 * PURE and deterministic (INV-01): no language model, no clock read, no I/O. All numbers come from the PROPOSED registry entry `glucose_response.rules`.
 * The input is a series of labelled points, so a continuous glucose monitor can be added later by listing "cgm" in `allowed_sources`; nothing here
 * assumes a fingerstick.
 */

export interface GlucoseResponseConfig {
  readonly min_pairs_to_show: number;
  readonly max_age_days: number;
  readonly before_window_minutes: number;
  readonly before_grace_minutes: number;
  readonly after_target_minutes: number;
  readonly after_window_minutes: { readonly min: number; readonly max: number };
  readonly plausible_mmol: { readonly min: number; readonly max: number };
  readonly allowed_sources: readonly string[];
  readonly before_contexts: readonly string[];
  readonly after_contexts: readonly string[];
  readonly skip_if_other_meal_between: boolean;
}

export interface GlucosePoint {
  /** ISO timestamp. */
  readonly at: string;
  readonly mmol: number;
  /** "fingerstick" today; "cgm" is dormant until a source is allowed in the config. */
  readonly source: string;
  /** The timing tag: fasting, pre_meal, post_meal, random, bedtime, night; null when untagged. */
  readonly context: string | null;
}

export interface MealFood {
  readonly code: string | null;
  readonly name: string;
}

export interface MealForPairing {
  readonly id: string;
  /** ISO timestamp. */
  readonly loggedAt: string;
  readonly foods: readonly MealFood[];
}

export interface MealPair {
  readonly mealId: string;
  readonly mealAt: string;
  readonly beforeMmol: number;
  readonly afterMmol: number;
  readonly changeMmol: number;
  readonly foods: readonly MealFood[];
}

export interface ResponseGroup {
  /** "all" for every paired meal, otherwise the food code (or lower-cased name when it has none). */
  readonly key: string;
  readonly label: string;
  readonly n: number;
  readonly beforeMin: number;
  readonly beforeMax: number;
  readonly afterMin: number;
  readonly afterMax: number;
  readonly changeMin: number;
  readonly changeMax: number;
}

export interface GlucoseResponseSummary {
  readonly mealsConsidered: number;
  readonly pairedMeals: number;
  /** Groups with at least min_pairs_to_show pairs, most pairs first. The "all" group comes first when it qualifies. Empty when there is not enough. */
  readonly groups: readonly ResponseGroup[];
  readonly enoughData: boolean;
}

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function contextOf(p: GlucosePoint): string {
  return p.context ?? "untagged";
}

function closest(points: readonly GlucosePoint[], targetMs: number): GlucosePoint | null {
  let best: GlucosePoint | null = null;
  let bestDiff = Infinity;
  for (const p of points) {
    const diff = Math.abs(Date.parse(p.at) - targetMs);
    if (diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

export function pairMeals(meals: readonly MealForPairing[], series: readonly GlucosePoint[], config: GlucoseResponseConfig, nowIso: string): readonly MealPair[] {
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) return [];
  const oldest = nowMs - config.max_age_days * DAY_MS;
  const usable = series.filter(
    (p) =>
      config.allowed_sources.includes(p.source) &&
      Number.isFinite(p.mmol) &&
      p.mmol >= config.plausible_mmol.min &&
      p.mmol <= config.plausible_mmol.max &&
      !Number.isNaN(Date.parse(p.at)),
  );
  const befores = usable.filter((p) => config.before_contexts.includes(contextOf(p)));
  const afters = usable.filter((p) => config.after_contexts.includes(contextOf(p)));
  const mealTimes = meals.map((m) => Date.parse(m.loggedAt)).filter((t) => !Number.isNaN(t));

  const pairs: MealPair[] = [];
  for (const meal of meals) {
    const mealMs = Date.parse(meal.loggedAt);
    if (Number.isNaN(mealMs) || mealMs < oldest || mealMs > nowMs) continue;
    const before = closest(
      befores.filter((p) => {
        const t = Date.parse(p.at);
        return t >= mealMs - config.before_window_minutes * MIN_MS && t <= mealMs + config.before_grace_minutes * MIN_MS;
      }),
      mealMs,
    );
    const after = closest(
      afters.filter((p) => {
        const t = Date.parse(p.at);
        return t >= mealMs + config.after_window_minutes.min * MIN_MS && t <= mealMs + config.after_window_minutes.max * MIN_MS;
      }),
      mealMs + config.after_target_minutes * MIN_MS,
    );
    if (before === null || after === null) continue;
    // Another meal between this one and its "after" reading means the change cannot be put down to this meal's logging.
    const afterMs = Date.parse(after.at);
    if (config.skip_if_other_meal_between && mealTimes.some((t) => t > mealMs && t < afterMs)) continue;
    pairs.push({
      mealId: meal.id,
      mealAt: meal.loggedAt,
      beforeMmol: before.mmol,
      afterMmol: after.mmol,
      changeMmol: round1(after.mmol - before.mmol),
      foods: meal.foods,
    });
  }
  return pairs;
}

function groupOf(key: string, label: string, pairs: readonly MealPair[]): ResponseGroup {
  const b = pairs.map((p) => p.beforeMmol);
  const a = pairs.map((p) => p.afterMmol);
  const c = pairs.map((p) => p.changeMmol);
  return {
    key,
    label,
    n: pairs.length,
    beforeMin: Math.min(...b),
    beforeMax: Math.max(...b),
    afterMin: Math.min(...a),
    afterMax: Math.max(...a),
    changeMin: Math.min(...c),
    changeMax: Math.max(...c),
  };
}

export function summariseGlucoseResponse(meals: readonly MealForPairing[], series: readonly GlucosePoint[], config: GlucoseResponseConfig, nowIso: string): GlucoseResponseSummary {
  const pairs = pairMeals(meals, series, config, nowIso);
  const empty: GlucoseResponseSummary = { mealsConsidered: meals.length, pairedMeals: pairs.length, groups: [], enoughData: false };
  if (pairs.length < config.min_pairs_to_show) return empty;

  const byFood = new Map<string, { label: string; pairs: MealPair[] }>();
  for (const pair of pairs) {
    const seen = new Set<string>();
    for (const f of pair.foods) {
      const key = f.code ?? f.name.trim().toLowerCase();
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      const entry = byFood.get(key) ?? { label: f.name, pairs: [] };
      entry.pairs.push(pair);
      byFood.set(key, entry);
    }
  }
  const foodGroups = [...byFood.entries()]
    .filter(([, v]) => v.pairs.length >= config.min_pairs_to_show)
    .map(([key, v]) => groupOf(key, v.label, v.pairs))
    .sort((x, y) => y.n - x.n || x.label.localeCompare(y.label));
  return { mealsConsidered: meals.length, pairedMeals: pairs.length, groups: [groupOf("all", "all", pairs), ...foodGroups], enoughData: true };
}

/** "5.2 to 7.8" style range text in the caller's unit; one value when both ends read the same. `fmt` converts and rounds a mmol/L number. */
export function formatRange(min: number, max: number, fmt: (mmol: number) => string = (n) => String(round1(n))): string {
  const a = fmt(min);
  const b = fmt(max);
  return a === b ? a : `${a} to ${b}`;
}

export interface ResponseRow {
  readonly key: string;
  readonly label: string;
  readonly n: number;
  /** Ranges with the unit label, ready to put in a sentence. */
  readonly before: string;
  readonly after: string;
  readonly change: string;
}

/** Turns the groups into display rows. Ranges only: there is no average, no ranking and no "best" or "worst" field to show. */
export function responseRows(summary: GlucoseResponseSummary, fmt: (mmol: number) => string, unitLabel: string): readonly ResponseRow[] {
  return summary.groups.map((g) => ({
    key: g.key,
    label: g.label,
    n: g.n,
    before: `${formatRange(g.beforeMin, g.beforeMax, fmt)} ${unitLabel}`,
    after: `${formatRange(g.afterMin, g.afterMax, fmt)} ${unitLabel}`,
    change: `${formatRange(g.changeMin, g.changeMax, fmt)} ${unitLabel}`,
  }));
}

// ---------------------------------------------------------------------------
// Parsing the two inputs (shared by web and mobile so the rules cannot differ)
// ---------------------------------------------------------------------------

export type GlucoseSeriesAnswer = { readonly state: "unavailable" } | { readonly state: "ok"; readonly points: readonly GlucosePoint[] };

/** Reads public.my_glucose_series(). Anything unexpected is "unavailable"; a malformed point is dropped rather than guessed. */
export function parseGlucoseSeries(json: unknown): GlucoseSeriesAnswer {
  if (typeof json !== "object" || json === null) return { state: "unavailable" };
  const o = json as Record<string, unknown>;
  if (o.state !== "ok" || !Array.isArray(o.readings)) return { state: "unavailable" };
  const points: GlucosePoint[] = [];
  for (const r of o.readings as unknown[]) {
    if (typeof r !== "object" || r === null) continue;
    const p = r as Record<string, unknown>;
    if (typeof p.at !== "string" || typeof p.mmol !== "number" || typeof p.source !== "string") continue;
    points.push({ at: p.at, mmol: p.mmol, source: p.source, context: typeof p.context === "string" ? p.context : null });
  }
  return { state: "ok", points };
}

export interface FoodLogRow {
  readonly id: string;
  readonly logged_at: string;
  readonly items: unknown;
}

/** Turns food_logs rows into meals. Only matched items with a name count as foods; a meal with none still counts in the overall range. */
export function mealsFromFoodLogs(rows: readonly FoodLogRow[]): readonly MealForPairing[] {
  return rows.map((row) => {
    const foods: MealFood[] = [];
    if (Array.isArray(row.items)) {
      for (const it of row.items as unknown[]) {
        if (typeof it !== "object" || it === null) continue;
        const item = it as Record<string, unknown>;
        if (item.matched !== true || typeof item.foodName !== "string" || item.foodName === "") continue;
        foods.push({ code: typeof item.foodCode === "string" ? item.foodCode : null, name: item.foodName });
      }
    }
    return { id: row.id, loggedAt: row.logged_at, foods };
  });
}
