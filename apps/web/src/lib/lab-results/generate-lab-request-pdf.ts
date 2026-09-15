import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { LabRequestDocument, type LabRequestData } from "@/lib/lab-results/lab-request-document";

export type GenerateLabRequestPdfResult =
  | { ok: true; buffer: Buffer; filename: string; orderNumber: string | null }
  | { ok: false; error: "not_found" };

/**
 * Builds the take-anywhere test request PDF for one lab order.
 *
 * Shared between two callers that reach it through different authority:
 *
 *   1. The patient-facing route (/api/patient/lab-order/[orderId]/request),
 *      which passes the caller's own cookie-session client — every read is
 *      scoped by that session's RLS, so a foreign orderId simply returns
 *      nothing and the caller 404s rather than leaking that the order exists.
 *
 *   2. The internal, service-key-authenticated route
 *      (/api/internal/notifications/lab-order-request-pdf/[orderId]) that
 *      the send-pending-notifications Edge Function calls to attach this PDF
 *      to the automatic "your test request is ready" email. That caller
 *      passes a service-role client, which bypasses RLS — safe only because
 *      that route itself is locked behind NOTIFICATIONS_SERVICE_KEY, checked
 *      before this function is ever reached.
 *
 * Deliberately takes a SupabaseClient rather than constructing one, so this
 * function never decides its own authority — the caller does, by which
 * client it hands in. Never call this with a service-role client from
 * anywhere a patient's own request could reach it.
 */
export async function generateLabRequestPdf(
  supabase: SupabaseClient<Database>,
  orderId: string,
): Promise<GenerateLabRequestPdfResult> {
  const { data: order } = await supabase
    .from("lab_orders")
    .select(
      "id, order_number, ordered_at, patient_id, ordered_by, clinical_indication, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name, description, test_codes)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "not_found" };

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name, patient_number, date_of_birth, sex")
    .eq("id", order.patient_id)
    .maybeSingle();
  if (!patient) return { ok: false, error: "not_found" };

  // Resolve the bundle's test_codes to display names. Missing codes are simply
  // omitted rather than printed raw — a lab reading "hba1c" is fine, a patient
  // reading it is not, and the panel name already carries the meaning.
  const testCodes = order.panel_bundle?.test_codes ?? [];
  let testNames: string[] = [];
  if (testCodes.length > 0) {
    const { data: tests } = await supabase
      .from("lab_tests")
      .select("code, name")
      .in("code", testCodes);
    const nameByCode = new Map((tests ?? []).map((t) => [t.code, t.name]));
    testNames = Array.from(
      new Set(testCodes.map((code) => nameByCode.get(code)).filter((n): n is string => !!n)),
    );
  }

  // Null-gated attribution, exactly like ReviewedByDoctor: a name is printed
  // only when a real clinical_staff row backs it, never a placeholder.
  let requestedByName: string | null = null;
  let requestedByCredentialType: string | null = null;
  let requestedByCredentialNumber: string | null = null;
  if (order.ordered_by) {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("full_name, credential_type, credential_number")
      .eq("id", order.ordered_by)
      .maybeSingle();
    if (staff?.full_name) {
      requestedByName = staff.full_name;
      requestedByCredentialType = staff.credential_type;
      requestedByCredentialNumber = staff.credential_number;
    }
  }

  const data: LabRequestData = {
    patientName: patient.full_name ?? "Patient",
    patientNumber: patient.patient_number,
    dateOfBirth: patient.date_of_birth,
    sex: patient.sex,
    orderNumber: order.order_number,
    orderedAt: order.ordered_at,
    panelName: order.panel_bundle?.name ?? "Requested tests",
    panelDescription: order.panel_bundle?.description ?? null,
    testNames,
    requestedByName,
    requestedByCredentialType,
    requestedByCredentialNumber,
    clinicalIndication: order.clinical_indication,
  };

  const buffer = await renderToBuffer(LabRequestDocument({ data }));
  const filename = order.order_number
    ? `tarragon-test-request-${order.order_number}.pdf`
    : "tarragon-test-request.pdf";

  return { ok: true, buffer, filename, orderNumber: order.order_number };
}
