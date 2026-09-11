import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums } from "@tarragon/shared";

/**
 * Native data layer for the Lab Orders & Results screen — the WebView modal
 * this replaces rendered apps/web/src/app/(dashboard)/patient/(sections)/
 * labs/page.tsx (test requests, result interpretations, result documents,
 * results-over-time trends, and the read-only test catalogue). Mirrors that
 * page's query shapes but is a fresh implementation, not a port — apps/web
 * isn't a package the mobile app can import from (Next.js-only path
 * aliases), same reasoning as prevention.ts's header comment. Every query
 * goes through the same RLS-scoped client every other native screen uses;
 * no service-role access.
 *
 * Deliberately NOT ported:
 *  - Booking a due screening / ordering an ad hoc test (useCreateLabOrder /
 *    LabCatalogue's booking path) — self-arranged order creation is tied to
 *    the screening calendar's due-schedule state (Prevention screen), and
 *    per the founder's 2026-08-03 self-arranged-fulfilment decision there is
 *    no facility directory or booking flow to build a "book this" action
 *    towards. This screen is read/track only, same as the web catalogue's own
 *    "read-only per the clinician-originated-orders guardrail" note.
 *  - The partner-lab visit request (RequestPartnerLabVisit) and vaccination
 *    booking-requests list (BookingRequestsList) — both are facility-
 *    selection flows (FacilitySelector) layered on the dormant/near-empty
 *    partner-lab network. CLAUDE.md is explicit the platform has no facility
 *    directory or booking UI; building one natively here would be new scope,
 *    not a WebView replacement.
 *  - The paid "Discuss this with a Tarragon doctor" consult CTA on an
 *    unreviewed AI summary (AiResultSummary) — that starts a Paystack
 *    payment redirect with no native payment flow to hand it to. The status
 *    text itself is shown; the CTA is not.
 *  - Downloading the printable "take to any lab" request PDF
 *    (/api/patient/lab-order/[orderId]/request) — that route is cookie-
 *    session-authenticated (Next.js server client reading the web app's own
 *    cookies), which a bearer-authenticated native client has no access to
 *    (see webview-screen.tsx's "separate cookie jar" note). The same
 *    information the PDF prints (panel name, prep instructions, order
 *    number) is already shown inline on each order card here instead.
 *  - Per-order "Upload your result" / ECG uploader (PatientResultUpload /
 *    EcgReportUpload) — the task brief is explicit the existing native
 *    camera-capture upload in labs-screen.tsx is not to be touched or
 *    duplicated. Each awaiting-result order instead points back to that
 *    existing "Upload a result" card.
 */

export type LabOrderStatus = Enums<"lab_order_status">;
export type LabOrderUrgency = Enums<"lab_order_urgency">;

export interface LabOrderItem {
  id: string;
  orderNumber: string | null;
  status: LabOrderStatus;
  urgency: LabOrderUrgency;
  orderedAt: string;
  panelBundleName: string;
  testCount: number;
  /** An ECG is its own physical printout, even in a bundle that also
   * includes blood tests — mirrors lab-orders-list.tsx's includesEcg flag,
   * used only to add an informational note here (see the module comment on
   * why the ECG-specific uploader itself isn't duplicated). */
  includesEcg: boolean;
  preparationInstructions: string | null;
  clinicalIndication: string | null;
  /** Null-gated "ordered by" attribution — only a clinician-generated order
   * ever sets this; a self-service due-screening order stays null. */
  orderedByName: string | null;
}

const LAB_ORDER_SELECT =
  "id, order_number, status, urgency, ordered_at, clinical_indication, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name, test_codes, preparation_instructions), ordered_by_staff:clinical_staff!lab_orders_ordered_by_fkey(full_name)";

const AWAITING_RESULT_STATUSES: LabOrderStatus[] = ["payment_confirmed", "ordered", "processing"];

export function isAwaitingResult(status: LabOrderStatus): boolean {
  return AWAITING_RESULT_STATUSES.includes(status);
}

/** Patient's own lab_orders, newest first. RLS (patient_id = auth.uid()) does the scoping. */
export async function getLabOrders(patientId: string): Promise<QueryResult<LabOrderItem[]>> {
  try {
    const { data, error } = await supabase
      .from("lab_orders")
      .select(LAB_ORDER_SELECT)
      .eq("patient_id", patientId)
      .order("ordered_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        urgency: row.urgency,
        orderedAt: row.ordered_at,
        panelBundleName: row.panel_bundle?.name ?? "Lab test",
        testCount: row.panel_bundle?.test_codes?.length ?? 0,
        includesEcg: row.panel_bundle?.test_codes?.includes("ecg_resting") ?? false,
        preparationInstructions: row.panel_bundle?.preparation_instructions ?? null,
        clinicalIndication: row.clinical_indication,
        orderedByName: row.ordered_by_staff?.full_name ?? null,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ResultStatus = Enums<"result_status">;

export interface LabResultInterpretationItem {
  id: string;
  createdAt: string;
  resultStatus: ResultStatus | null;
  summary: string | null;
}

interface StoredInterpretation {
  result_status?: ResultStatus;
  summary?: string;
}

/** Patient's own ML/clinician result verdicts — mirrors lab-results.tsx. */
export async function getLabResultInterpretations(
  patientId: string
): Promise<QueryResult<LabResultInterpretationItem[]>> {
  try {
    const { data, error } = await supabase
      .from("lab_result_interpretations")
      .select("id, interpretation, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => {
        const interpretation = (row.interpretation ?? {}) as StoredInterpretation;
        return {
          id: row.id,
          createdAt: row.created_at,
          resultStatus: interpretation.result_status ?? null,
          summary: interpretation.summary ?? null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ResultDocumentSource = Enums<"lab_result_document_source">;
export type AiSummaryStatus = Enums<"lab_result_ai_summary_status">;

/** Same storage bucket as apps/web/src/lib/lab-results/documents.ts's
 * RESULT_DOC_BUCKET — kept as a local literal since that file is
 * server-only and not importable from the mobile app. */
const RESULT_DOC_BUCKET = "lab-result-documents";

export interface ResultDocumentItem {
  id: string;
  source: ResultDocumentSource;
  originalFilename: string | null;
  note: string | null;
  createdAt: string;
  isPdf: boolean;
  /** Short-lived signed URL for the file, or null if it could not be
   * signed. Minted client-side: the storage bucket's own RLS policy lets a
   * patient read objects under their own uid folder directly (see
   * 20260720120100_lab_result_documents.sql's "lab result doc patient
   * select" policy) — unlike org staff, who have no such policy and so the
   * web app's service-role signer exists for their case, not this one. */
  signedUrl: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  patientInterpretation: string | null;
  nextSteps: string | null;
  interpretationSentAt: string | null;
  aiSummaryStatus: AiSummaryStatus;
}

/**
 * Patient's own result documents (PDFs/images uploaded by them or their care
 * team), each with a short-lived signed URL and — once a doctor has sent
 * one — that interpretation and any next steps. Mirrors result-documents.tsx
 * minus the paid "discuss this" consult CTA (see the module comment).
 */
export async function getResultDocuments(patientId: string): Promise<QueryResult<ResultDocumentItem[]>> {
  try {
    const { data: rows, error } = await supabase
      .from("lab_result_documents")
      .select(
        "id, source, original_filename, mime_type, note, created_at, file_path, reviewed_by, reviewed_at, patient_interpretation, next_steps, interpretation_sent_at, ai_summary_status"
      )
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    if (!rows || rows.length === 0) return { ok: true, data: [] };

    // Batch-resolve reviewer names in one query rather than N+1 — same
    // null-gated attribution as ReviewedResultLine on web, but reviewed_by
    // on this table references profiles.id, so the lookup joins through
    // clinical_staff.profile_id.
    const reviewerIds = [...new Set(rows.map((r) => r.reviewed_by).filter((id): id is string => !!id))];
    const reviewerNameByProfileId = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const { data: staff } = await supabase
        .from("clinical_staff")
        .select("profile_id, full_name")
        .in("profile_id", reviewerIds)
        .eq("active", true);
      for (const s of staff ?? []) {
        if (s.profile_id) reviewerNameByProfileId.set(s.profile_id, s.full_name);
      }
    }

    const items = await Promise.all(
      rows.map(async (row) => {
        let signedUrl: string | null = null;
        if (row.file_path) {
          const { data: signed } = await supabase.storage
            .from(RESULT_DOC_BUCKET)
            .createSignedUrl(row.file_path, 300);
          signedUrl = signed?.signedUrl ?? null;
        }
        return {
          id: row.id,
          source: row.source,
          originalFilename: row.original_filename,
          note: row.note,
          createdAt: row.created_at,
          isPdf: row.mime_type === "application/pdf",
          signedUrl,
          reviewedAt: row.reviewed_at,
          reviewedByName: row.reviewed_by ? reviewerNameByProfileId.get(row.reviewed_by) ?? null : null,
          patientInterpretation: row.patient_interpretation,
          nextSteps: row.next_steps,
          interpretationSentAt: row.interpretation_sent_at,
          aiSummaryStatus: row.ai_summary_status,
        };
      })
    );
    return { ok: true, data: items };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const ANALYTE_LABEL: Record<string, string> = {
  hba1c: "HbA1c",
  fasting_glucose: "Fasting glucose",
  psa: "PSA",
  creatinine: "Creatinine",
  egfr: "eGFR",
  total_cholesterol: "Total cholesterol",
  ldl: "LDL cholesterol",
  hdl: "HDL cholesterol",
  triglycerides: "Triglycerides",
};

function labelForAnalyte(code: string): string {
  if (code in ANALYTE_LABEL) return ANALYTE_LABEL[code];
  const spaced = code.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface AnalyteTrendItem {
  code: string;
  label: string;
  latestValue: number;
  latestUnit: string | null;
  latestTakenAt: string;
  previousValue: number | null;
  previousTakenAt: string | null;
}

/**
 * Latest + previous reading per lab analyte code — mirrors
 * results-trends-card.tsx's useAnalyteTrends. No good/bad verdict is
 * rendered; that stays the reviewing doctor's job. This worktree's copy of
 * lib/prevention.ts predates the getAnalyteTrends helper referenced in the
 * task brief (an older checkout of that file), so the query lives here
 * instead of being imported from there.
 */
export async function getAnalyteTrends(patientId: string): Promise<QueryResult<AnalyteTrendItem[]>> {
  try {
    const { data, error } = await supabase
      .from("lab_analyte_readings")
      .select("code, value, unit, taken_at")
      .eq("patient_id", patientId)
      .order("taken_at", { ascending: false })
      .limit(200);
    if (error) return { ok: false, error: error.message };

    const byCode = new Map<string, { code: string; value: number; unit: string | null; taken_at: string }[]>();
    for (const row of data ?? []) {
      // A qualitative/text-only result (value_text, no numeric value) has
      // nothing to trend or delta against — skip it rather than let a null
      // silently become NaN downstream.
      if (row.value === null) continue;
      const list = byCode.get(row.code) ?? [];
      if (list.length < 2) list.push({ ...row, value: row.value });
      byCode.set(row.code, list);
    }
    const trends = [...byCode.entries()].map(([code, readings]) => ({
      code,
      label: labelForAnalyte(code),
      latestValue: readings[0].value,
      latestUnit: readings[0].unit,
      latestTakenAt: readings[0].taken_at,
      previousValue: readings[1]?.value ?? null,
      previousTakenAt: readings[1]?.taken_at ?? null,
    }));
    trends.sort((a, b) => (a.latestTakenAt < b.latestTakenAt ? 1 : -1));
    return { ok: true, data: trends };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface LabCatalogueItem {
  id: string;
  name: string;
  description: string | null;
  preparationInstructions: string | null;
  testCount: number;
}

/**
 * Active panel_bundles, read-only — mirrors lab-catalogue.tsx. No price is
 * shown, same reasoning as the web catalogue: self-arranged browsing only,
 * a price next to a bundle nobody can act on from here would misleadingly
 * imply this view can charge the patient. Individual test-code names aren't
 * resolved (that map is patient-facing copy owned by
 * apps/web/src/lib/labs/test-code-labels.ts, not importable here) — a test
 * count stands in for "Includes: …" instead.
 */
export async function getLabCatalogue(): Promise<QueryResult<LabCatalogueItem[]>> {
  try {
    const { data, error } = await supabase
      .from("panel_bundles")
      .select("id, name, description, preparation_instructions, test_codes")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        preparationInstructions: row.preparation_instructions,
        testCount: row.test_codes?.length ?? 0,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
