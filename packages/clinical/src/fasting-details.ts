import { mayStartFast, parseFastingAnswer, UNAVAILABLE_FASTING_ANSWER, type Fast, type PublicFastingAnswer } from "./fasting-safety";

/**
 * What the fasting screen shows beyond the one-word answer: the expected dates, the plan the person already started, and the medicine timing
 * plan their clinician signed. Every field here is written by a person (the clinician's own words and name) or is a date; nothing is generated.
 * Anything that does not read exactly as expected is dropped, never guessed.
 */
export interface FastingDetails {
  readonly answer: PublicFastingAnswer;
  readonly calendar: { readonly status: "expected"; readonly start: string; readonly end: string } | { readonly status: "unknown" };
  /** The person's own active plan (public.my_fasting_plan), whatever the gate now says. */
  readonly plan: { readonly id: string; readonly fast: Fast; readonly startsOn: string; readonly endsOn: string } | null;
  readonly planPaused: boolean;
  readonly timingPlans: readonly { readonly summary: string; readonly signedByName: string | null; readonly signedAt: string; readonly validFrom: string; readonly validTo: string }[];
}

export const UNAVAILABLE_DETAILS: FastingDetails = {
  answer: UNAVAILABLE_FASTING_ANSWER,
  calendar: { status: "unknown" },
  plan: null,
  planPaused: false,
  timingPlans: [],
};

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/** Reads the person's active plan (public.my_fasting_plan). Anything unexpected is "no plan shown", never a guessed one. */
export function parseFastingPlan(json: unknown): FastingDetails["plan"] {
  const p = json as Record<string, unknown> | null | undefined;
  if (!p || !isStr(p.id) || !isStr(p.starts_on) || !isStr(p.ends_on) || (p.fast !== "ramadan" && p.fast !== "lent")) return null;
  return { id: p.id, fast: p.fast, startsOn: p.starts_on, endsOn: p.ends_on };
}

/**
 * Combines the gate answer with the person's own plan. The plan is shown even when the gate says unavailable (a person who has since become pregnant
 * must still be able to see and end the plan they started); it is "paused" whenever the gate no longer allows it, and nothing else about why.
 */
export function parseFastingDetails(gateJson: unknown, planJson: unknown = null): FastingDetails {
  const answer = parseFastingAnswer(gateJson);
  const plan = parseFastingPlan(planJson);
  const planPaused = plan !== null && !mayStartFast(answer);
  // The unavailable answer carries nothing else: the screen must not be able to show dates or a timing plan the database did not choose to give.
  if (answer.state === "unavailable") return { ...UNAVAILABLE_DETAILS, plan, planPaused };
  const o = gateJson as Record<string, unknown>;
  const cal = o.calendar as Record<string, unknown> | undefined;
  const calendar = cal && cal.status === "expected" && isStr(cal.start) && isStr(cal.end) ? ({ status: "expected", start: cal.start, end: cal.end } as const) : ({ status: "unknown" } as const);
  const timingPlans = Array.isArray(o.timing_plans)
    ? (o.timing_plans as unknown[]).flatMap((raw) => {
        const r = raw as Record<string, unknown> | null;
        if (!r || !isStr(r.summary) || !isStr(r.signed_at) || !isStr(r.valid_from) || !isStr(r.valid_to)) return [];
        return [{ summary: r.summary, signedByName: isStr(r.signed_by_name) ? r.signed_by_name : null, signedAt: r.signed_at, validFrom: r.valid_from, validTo: r.valid_to }];
      })
    : [];
  return { answer, calendar, plan, planPaused, timingPlans };
}
