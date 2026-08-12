import { createClient } from "@/lib/supabase/server";
import { ScreenOrderChecklist, type ScreenOrderChecklistItem } from "./screen-order-checklist";
import { SCREEN_TYPE_LABELS } from "./screening-result-form";

/**
 * A Comprehensive Screen order that only lacks a dormant code already reads
 * "resulted" per private.check_screen_order_completeness — it's never shown
 * as outstanding. breast_imaging (20260811222950) and abdominal_ultrasound/
 * prostate_ultrasound (20260811233511) are no longer in this set — all
 * three are self-arranged like fit/mammography now (patient takes the order
 * to any imaging facility near them and uploads the result), so a
 * Comprehensive Screen order genuinely needs them resulted before it
 * auto-resolves. echo stays dormant: it's conditional on an ECG/BP/symptom
 * finding, not a calendar screen, and was never added to any
 * panel_bundles.test_codes in the first place.
 */
const DORMANT_CODES = new Set(["echo"]);
/** Same once-per-lifetime set as private.check_screen_order_completeness. */
const ONCE_PER_LIFETIME = new Set(["sickle_cell_genotype", "blood_group"]);
const SCREEN_BUNDLE_CODES = ["screen_core", "screen_advanced", "screen_comprehensive"];

function ageFromDob(dateOfBirth: string): number {
  return Math.floor(
    (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
}

/**
 * Shows every open Screen-tier (Core/Advanced/Comprehensive) order for this
 * patient as a checklist of outstanding lab codes, each opening
 * ScreeningResultForm pre-set to that order + code. Mirrors, for display
 * purposes only, the same sex/age/once-per-lifetime logic
 * private.check_screen_order_completeness enforces server-side — the
 * enforcement itself lives in the DB trigger, this is composition over it,
 * never a second source of truth for what actually flips an order to
 * 'resulted'.
 */
export async function ScreenOrderResultsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const [{ data: patient }, { data: orders }] = await Promise.all([
    supabase.from("profiles").select("sex, date_of_birth").eq("id", patientId).maybeSingle(),
    supabase
      .from("lab_orders")
      .select("id, order_number, status, panel_bundle:panel_bundles(code, name, test_codes)")
      .eq("patient_id", patientId)
      .in("status", ["payment_confirmed", "processing", "sample_collected"])
      .order("ordered_at", { ascending: false }),
  ]);

  if (!patient) return null;

  const screenOrders = (orders ?? []).filter(
    (o) => o.panel_bundle && SCREEN_BUNDLE_CODES.includes(o.panel_bundle.code)
  );
  if (screenOrders.length === 0) return null;

  const allCodes = Array.from(new Set(screenOrders.flatMap((o) => o.panel_bundle!.test_codes)));

  const [{ data: screenTypes }, { data: results }] = await Promise.all([
    supabase
      .from("screen_types")
      .select("code, name, sex_applicability, age_from, age_to")
      .in("code", allCodes),
    supabase
      .from("screening_results")
      .select("id, screen_type_code, lab_order_id, result_status, follow_up_action")
      .eq("patient_id", patientId),
  ]);

  const stByCode = new Map((screenTypes ?? []).map((s) => [s.code, s]));
  const age = patient.date_of_birth ? ageFromDob(patient.date_of_birth) : null;

  const items: ScreenOrderChecklistItem[] = screenOrders.map((order) => {
    const bundle = order.panel_bundle!;
    const codes = bundle.test_codes
      .filter((code) => !DORMANT_CODES.has(code))
      .filter((code) => {
        const st = stByCode.get(code);
        if (!st) return true;
        if (st.sex_applicability && st.sex_applicability !== "all" && st.sex_applicability !== patient.sex) {
          return false;
        }
        if (st.age_from != null && age != null && age < st.age_from) return false;
        if (st.age_to != null && age != null && age > st.age_to) return false;
        return true;
      })
      .map((code) => {
        const result = (results ?? []).find(
          (r) =>
            r.screen_type_code === code &&
            (ONCE_PER_LIFETIME.has(code) ? true : r.lab_order_id === order.id)
        );
        return {
          code,
          label: stByCode.get(code)?.name ?? SCREEN_TYPE_LABELS[code as keyof typeof SCREEN_TYPE_LABELS] ?? code,
          satisfied: Boolean(result),
          resultId: result?.id ?? null,
          resultStatus: result?.result_status ?? null,
          followUpAction: result?.follow_up_action ?? null,
        };
      });

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      bundleName: bundle.name,
      codes,
    };
  });

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <ScreenOrderChecklist key={item.orderId} patientId={patientId} item={item} />
      ))}
    </div>
  );
}
