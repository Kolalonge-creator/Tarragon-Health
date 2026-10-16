/**
 * The snoring and daytime sleepiness questionnaire (S57, function 10.11; redrafted S57b to follow the published STOP-Bang items).
 * Item ids and kinds only: the wording lives in i18n (`sleep.screen.*`) and the points and cut-off live in the server's active
 * `sleep_apnoea_screen_config` (PROPOSED, DRAFT, unsigned until the CMO confirms). The client never scores and never decides a result;
 * it collects answers, sends them, and shows the server's reply, and only when the server says the instrument is signed.
 */
export const SLEEP_SCREEN_ITEM_IDS = ["snoring", "tired", "observed_pauses", "high_blood_pressure", "bmi", "age_over_50", "neck", "sex_male"] as const;
export type SleepScreenItemId = (typeof SLEEP_SCREEN_ITEM_IDS)[number];
export type SleepScreenAnswer = "yes" | "no" | "unsure";
export type SleepScreenItemKind = "yes_no" | "bmi" | "neck_cm";
export interface SleepScreenItem {
  readonly id: string;
  readonly kind: SleepScreenItemKind;
}

export interface SleepScreenResult {
  readonly saved: boolean;
  readonly show_result: boolean;
  readonly cut_off_met: boolean | null;
  readonly unsure_count: number;
}

/** Which of the result messages to show. An unsigned instrument shows only that the answers were saved. */
export function sleepScreenMessageKey(r: SleepScreenResult): "sleep.screen.saved_only" | "sleep.screen.talk_to_care_team" | "sleep.screen.nothing_flagged" {
  if (!r.show_result || r.cut_off_met === null) return "sleep.screen.saved_only";
  return r.cut_off_met ? "sleep.screen.talk_to_care_team" : "sleep.screen.nothing_flagged";
}

/** What the form holds: yes/no/unsure by item id, and the three measurements as the text typed, or "unsure". */
export type SleepScreenForm = Readonly<Record<string, string | undefined>>;

const RANGE = { height_cm: [100, 230], weight_kg: [25, 350], neck_cm: [20, 80] } as const;
type Measure = keyof typeof RANGE;

function measure(form: SleepScreenForm, key: Measure): number | "unsure" | null {
  const raw = (form[key] ?? "").trim();
  if (raw === "unsure") return "unsure";
  if (raw === "" || !/^\d{1,3}([.,]\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw.replace(",", "."));
  const [lo, hi] = RANGE[key];
  return n >= lo && n <= hi ? n : null;
}

/**
 * Builds the answers object the server expects, or says what is missing. "incomplete" covers a blank, a non-number and a number outside a
 * plausible range alike (the server refuses those too). The measurements are never turned into a category here.
 */
export function sleepScreenAnswers(items: readonly SleepScreenItem[], form: SleepScreenForm): { ok: true; answers: Record<string, string | number> } | { ok: false } {
  const out: Record<string, string | number> = {};
  for (const item of items) {
    if (item.kind === "yes_no") {
      const v = form[item.id];
      if (v !== "yes" && v !== "no" && v !== "unsure") return { ok: false };
      out[item.id] = v;
    } else {
      const keys: Measure[] = item.kind === "bmi" ? ["height_cm", "weight_kg"] : ["neck_cm"];
      for (const k of keys) {
        const m = measure(form, k);
        if (m === null) return { ok: false };
        out[k] = m;
      }
    }
  }
  return { ok: true, answers: out };
}
