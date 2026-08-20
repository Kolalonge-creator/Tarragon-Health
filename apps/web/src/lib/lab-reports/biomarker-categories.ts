/**
 * Biomarker category rollup — groups a patient's reviewed lab interpretations
 * into a small set of patient-facing body-system categories with a
 * good/needs-attention status.
 *
 * Two safety rules this deliberately follows, both taken from constraints
 * that already exist elsewhere in this codebase rather than invented here:
 *
 * 1. NEVER uses `analyte-catalogue.ts`'s `refLow`/`refHigh` bands to classify
 *    anything — that file's own header is explicit they are "ORIENTATION
 *    ONLY... never used to classify a result, raise an alert, or tell a
 *    patient anything." Only `getAnalyte(code).group` (the vocabulary, not
 *    the reference band) is used here, to know which category an analyte
 *    code belongs to.
 * 2. ONLY rolls up `lab_result_interpretations` rows where `source =
 *    'clinician'`. `source` defaults to `'ml'` and can also be `'rule'`
 *    (20260705211315_care_coordination.sql) — neither is a signed clinical
 *    verdict in the way `cv_risk_config` is, so neither is trusted here.
 *
 * Granularity note: `lab_result_interpretations` carries one `result_status`
 * per lab ORDER (via `interpretation.result_status`, written by the
 * clinician-side screening-result-form — see (dashboard)/patient/
 * lab-results.tsx, which already surfaces these to patients per-order). It
 * does not carry one status per analyte. A single order can cover several
 * analyte codes (`lab_orders.panel_bundle_id` -> `panel_bundles.test_codes`),
 * which can span more than one category. If ANY reviewed order touching a
 * category came back other than 'normal', that category is marked "needs
 * attention" — the conservative direction, never averaged down to "good".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ScreeningResultStatus } from "@tarragon/shared";
import { getAnalyte } from "./analyte-catalogue";

type ResultStatus = ScreeningResultStatus;

export type BiomarkerCategoryKey = "heart" | "kidney" | "liver" | "blood_sugar";

const CATEGORY_LABEL: Record<BiomarkerCategoryKey, string> = {
  heart: "Heart health",
  kidney: "Kidney health",
  liver: "Liver health",
  blood_sugar: "Blood sugar",
};

/** Only the analyte groups with an established patient-facing category.
 * `haematology`/`electrolyte`/`thyroid`/`urinalysis`/`other` have no
 * category here yet — deliberately, rather than inventing a bucket. */
const GROUP_TO_CATEGORY: Partial<Record<string, BiomarkerCategoryKey>> = {
  lipid: "heart",
  renal: "kidney",
  liver: "liver",
  glycaemic: "blood_sugar",
};

export type BiomarkerCategoryView = {
  key: BiomarkerCategoryKey;
  label: string;
  /** null: no reviewed result on file yet — show "N results on file" (or
   * nothing), never a fabricated good/bad judgement. */
  status: "good" | "needs_attention" | null;
  /** How many reviewed orders touched this category — the "N on file"
   * count when status is null, or context when it isn't. */
  reviewedCount: number;
  needsAttentionCount: number;
};

/** Pure — the rollup rule itself, factored out so it's testable without a
 * DB: given the reviewed (result_status, testCodes) pairs actually touching
 * this patient's record, bucket them into categories. */
export function rollupBiomarkerCategories(
  reviewedOrders: readonly { resultStatus: ResultStatus; testCodes: readonly string[] }[]
): BiomarkerCategoryView[] {
  const byCategory = new Map<BiomarkerCategoryKey, ResultStatus[]>();

  for (const order of reviewedOrders) {
    const categories = new Set<BiomarkerCategoryKey>();
    for (const code of order.testCodes) {
      const group = getAnalyte(code)?.group;
      const category = group ? GROUP_TO_CATEGORY[group] : undefined;
      if (category) categories.add(category);
    }
    for (const category of categories) {
      const list = byCategory.get(category) ?? [];
      list.push(order.resultStatus);
      byCategory.set(category, list);
    }
  }

  return (Object.keys(CATEGORY_LABEL) as BiomarkerCategoryKey[]).map((key) => {
    const statuses = byCategory.get(key) ?? [];
    const needsAttentionCount = statuses.filter((s) => s !== "normal").length;
    return {
      key,
      label: CATEGORY_LABEL[key],
      status: statuses.length === 0 ? null : needsAttentionCount > 0 ? "needs_attention" : "good",
      reviewedCount: statuses.length,
      needsAttentionCount,
    };
  });
}

export async function getBiomarkerCategories(
  db: SupabaseClient<Database>,
  patientId: string
): Promise<BiomarkerCategoryView[]> {
  const { data: interpretations, error: interpretationsError } = await db
    .from("lab_result_interpretations")
    .select("interpretation, lab_order_id")
    .eq("patient_id", patientId)
    .eq("source", "clinician")
    .not("lab_order_id", "is", null);
  if (interpretationsError) throw interpretationsError;
  if (!interpretations?.length) return rollupBiomarkerCategories([]);

  const orderIds = [...new Set(interpretations.map((i) => i.lab_order_id as string))];
  const { data: orders, error: ordersError } = await db
    .from("lab_orders")
    .select("id, panel_bundles(test_codes)")
    .in("id", orderIds);
  if (ordersError) throw ordersError;

  const testCodesByOrder = new Map(
    (orders ?? []).map((o) => [
      o.id,
      (o.panel_bundles as { test_codes: string[] } | null)?.test_codes ?? [],
    ])
  );

  const reviewedOrders = interpretations
    .map((i) => {
      const resultStatus = (i.interpretation as { result_status?: ResultStatus } | null)
        ?.result_status;
      const testCodes = testCodesByOrder.get(i.lab_order_id as string) ?? [];
      return resultStatus ? { resultStatus, testCodes } : null;
    })
    .filter((x): x is { resultStatus: ResultStatus; testCodes: string[] } => x !== null);

  return rollupBiomarkerCategories(reviewedOrders);
}
