import { API_BASE_URL, fetchWithTimeoutAndRetry, NETWORK_ERROR_MESSAGE } from "./api";
import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

export interface UploadLabResultResult {
  success: boolean;
  error?: string;
}

export type PanelBundle = Tables<"panel_bundles">;

/** Mirrors apps/web/src/lib/queries/lab-orders.ts's useLabCatalogue — a
 * global, admin-editable reference table, readable directly by any
 * authenticated user, no API route needed. Shared by every native screen
 * that lets a patient self-book a panel bundle (the Sexual Health testing
 * tab today). */
export async function loadLabPanelBundles(): Promise<PanelBundle[]> {
  const { data } = await supabase.from("panel_bundles").select("*").eq("is_active", true).order("name", { ascending: true });
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
export async function uploadLabResult(photo: {
  uri: string;
  mimeType: string;
  fileName: string;
}): Promise<UploadLabResultResult> {
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
  formData.append("file", { uri: photo.uri, type: photo.mimeType, name: photo.fileName } as unknown as Blob);

  try {
    // Same timeout + single-retry policy as every JSON request in api.ts —
    // a raw fetch here previously had no timeout at all, so a stalled
    // connection hung the upload button indefinitely.
    const response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/lab-result-upload`, {
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
