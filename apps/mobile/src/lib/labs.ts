import {
  API_BASE_URL,
  fetchWithTimeoutAndRetry,
  NETWORK_ERROR_MESSAGE,
} from "./api";
import { supabase } from "./supabase";
import { testCodeLabel } from "./lab-catalogue-content";
import type { Tables } from "@tarragon/shared";

export interface UploadLabResultResult {
  success: boolean;
  error?: string;
}

/** Selecting this is the same as not picking a test type at all — never sent
 * as `test_code`. Mirrors apps/web/src/lib/labs/test-code-labels.ts's
 * OTHER_TEST_TYPE_VALUE (duplicated rather than imported: that file lives in
 * the web app's own package, not shared). */
export const OTHER_TEST_TYPE_VALUE = "other";

export interface TestTypeOption {
  value: string;
  label: string;
}

/**
 * Test types offered on the native "Upload a result" card — built from the
 * same TEST_CODE_LABELS mirror lab-catalogue-content.ts already keeps in
 * sync with the web app's test-code-labels.ts, filtered to the curated
 * subset apps/web/src/lib/labs/test-code-labels.ts offers for a result
 * DOCUMENT (as opposed to the full lab catalogue): excludes ecg_resting (its
 * own dedicated ECG capture) and the imaging scans — this card is for a
 * photographed lab printout, not a scan.
 */
const RESULT_DOCUMENT_TEST_CODES = [
  "fbc",
  "lipid_panel",
  "hba1c",
  "ogtt_fpg",
  "lft",
  "kft",
  "tft",
  "tsh",
  "free_t4",
  "urinalysis",
  "urine_acr",
  "blood_group",
  "sickle_cell_genotype",
  "hiv",
  "hep_b",
  "hep_c",
  "syphilis",
  "psa",
  "fit",
  "cervical_smear",
] as const;

export const RESULT_DOCUMENT_TEST_TYPE_OPTIONS: TestTypeOption[] = [
  ...RESULT_DOCUMENT_TEST_CODES.map((code) => ({
    value: code,
    label: testCodeLabel(code),
  })),
  { value: OTHER_TEST_TYPE_VALUE, label: "Something else / not sure" },
];

/** Patient-readable label for a stored test_code, or null when it wasn't
 * asked/known — used both to pre-fill the picker and to label/group an
 * already-uploaded result document. */
export function testTypeLabel(code: string | null): string | null {
  if (!code) return null;
  return (
    RESULT_DOCUMENT_TEST_TYPE_OPTIONS.find((option) => option.value === code)
      ?.label ?? null
  );
}

export type PanelBundle = Tables<"panel_bundles">;

/** Mirrors apps/web/src/lib/queries/lab-orders.ts's useLabCatalogue — a
 * global, admin-editable reference table, readable directly by any
 * authenticated user, no API route needed. Shared by every native screen
 * that lets a patient self-book a panel bundle (the Sexual Health testing
 * tab today). */
export async function loadLabPanelBundles(): Promise<PanelBundle[]> {
  const { data } = await supabase
    .from("panel_bundles")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });
  return data ?? [];
}

/**
 * Native camera-capture lab result upload (MOBILE_APP_SPEC.md §2.5) — a
 * multipart POST rather than JSON (api.ts's request() only handles JSON
 * bodies) so the photo streams straight through. Mirrors
 * uploadResultDocumentAsPatient in apps/web/src/lib/lab-results/actions.ts
 * via the Route Handler at apps/web/src/app/api/mobile/lab-result-upload —
 * same storage-then-insert-then-extract path a web upload takes.
 */
export async function uploadLabResult(
  photo: { uri: string; mimeType: string; fileName: string },
  /** Omit, or pass OTHER_TEST_TYPE_VALUE, for "not sure" — either way no
   * test_code is sent, same as before this field existed. */
  testCode?: string,
  /** Files the upload against a specific open request — the per-test
   * checklist (lab-order-test-checklist.tsx) always passes this; the
   * freeform "Upload a result" card omits it, same as before this param
   * existed. */
  labOrderId?: string,
): Promise<UploadLabResultResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { success: false, error: "Not signed in" };
  }

  const formData = new FormData();
  // React Native's fetch/FormData accepts { uri, type, name } for a local-file
  // upload (see convertRequestBody.js) — the DOM FormData.append() typings TS
  // resolves here don't know that shape, hence the cast.
  formData.append("file", {
    uri: photo.uri,
    type: photo.mimeType,
    name: photo.fileName,
  } as unknown as Blob);
  if (testCode && testCode !== OTHER_TEST_TYPE_VALUE) {
    formData.append("test_code", testCode);
  }
  if (labOrderId) {
    formData.append("lab_order_id", labOrderId);
  }

  try {
    // Same timeout + single-retry policy as every JSON request in api.ts —
    // a raw fetch here previously had no timeout at all, so a stalled
    // connection hung the upload button indefinitely.
    const response = await fetchWithTimeoutAndRetry(
      `${API_BASE_URL}/api/mobile/lab-result-upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      },
    );
    const json = (await response.json()) as {
      success?: boolean;
      error?: string;
    };
    if (!response.ok) {
      return {
        success: false,
        error: json.error ?? `Upload failed (${response.status})`,
      };
    }
    return { success: true };
  } catch {
    return { success: false, error: NETWORK_ERROR_MESSAGE };
  }
}

/**
 * "I photographed the wrong result" — swaps the file on a document the
 * patient uploaded themselves, in place, while it's still unreviewed.
 * Mirrors uploadLabResult's multipart shape, against
 * /api/mobile/lab-result-replace (replaceResultDocumentAsPatient's native
 * counterpart, DB-enforced by the same RLS/trigger change as the web path).
 */
export async function replaceLabResult(
  documentId: string,
  photo: { uri: string; mimeType: string; fileName: string },
): Promise<UploadLabResultResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { success: false, error: "Not signed in" };
  }

  const formData = new FormData();
  formData.append("document_id", documentId);
  formData.append("file", { uri: photo.uri, type: photo.mimeType, name: photo.fileName } as unknown as Blob);

  try {
    const response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/lab-result-replace`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
    const json = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok) {
      return { success: false, error: json.error ?? `Replace failed (${response.status})` };
    }
    return { success: true };
  } catch {
    return { success: false, error: NETWORK_ERROR_MESSAGE };
  }
}

/**
 * Native ECG upload — the per-test checklist's counterpart to
 * EcgReportUpload on web (apps/web/src/components/ecg-report-upload.tsx),
 * via the bearer-authenticated /api/mobile/ecg-report-upload route
 * (mirrors uploadEcgReportAsPatient). Never existed on mobile before this —
 * every prior native upload went through uploadLabResult regardless of
 * whether the test was actually an ECG.
 */
export async function uploadEcgReport(
  photo: { uri: string; mimeType: string; fileName: string },
  labOrderId?: string,
): Promise<UploadLabResultResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { success: false, error: "Not signed in" };
  }

  const formData = new FormData();
  formData.append("file", { uri: photo.uri, type: photo.mimeType, name: photo.fileName } as unknown as Blob);
  if (labOrderId) {
    formData.append("lab_order_id", labOrderId);
  }

  try {
    const response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/ecg-report-upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
    const json = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok) {
      return { success: false, error: json.error ?? `Upload failed (${response.status})` };
    }
    return { success: true };
  } catch {
    return { success: false, error: NETWORK_ERROR_MESSAGE };
  }
}
