import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import {
  LabRequestDocument,
  type LabRequestData,
} from "@/lib/lab-results/lab-request-document";

/**
 * The take-anywhere test request PDF for one lab order.
 *
 * Cookie-session auth, and every read runs through the caller's own RLS-scoped
 * session — lab_orders_select only admits the patient themselves, org staff, or
 * a consented clinical reader, so a foreign orderId simply returns nothing and
 * this 404s rather than leaking that the order exists.
 *
 * Never gated by plan: a patient holding an open request must always be able to
 * print it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: order } = await supabase
    .from("lab_orders")
    .select(
      "id, order_number, ordered_at, patient_id, ordered_by, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name, description, test_codes)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return new Response("Not found", { status: 404 });

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name, patient_number, date_of_birth, sex")
    .eq("id", order.patient_id)
    .maybeSingle();
  if (!patient) return new Response("Not found", { status: 404 });

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
  };

  const buffer = await renderToBuffer(LabRequestDocument({ data }));
  const filename = order.order_number
    ? `tarragon-test-request-${order.order_number}.pdf`
    : "tarragon-test-request.pdf";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
