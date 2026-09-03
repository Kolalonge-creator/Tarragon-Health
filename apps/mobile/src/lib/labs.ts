import { API_BASE_URL, fetchWithTimeoutAndRetry, NETWORK_ERROR_MESSAGE } from "./api";
import { supabase } from "./supabase";

export interface UploadLabResultResult {
  success: boolean;
  error?: string;
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
