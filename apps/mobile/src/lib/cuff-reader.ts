import { t } from "@tarragon/i18n";
import { API_BASE_URL, fetchWithTimeoutAndRetry } from "./api";
import { supabase } from "./supabase";

/**
 * "Read it for me" for a blood pressure cuff display (AI-022). OPTIONAL and OFF until the `cuff_camera_enabled` guard is on and the AI
 * registry's own switch is on. Unlike the rest of the photo screen, this one step DOES send the photo, once, to be read and dropped: the
 * server keeps nothing (apps/web/src/app/api/mobile/cuff-display-proposal/route.ts). The person is told that before they tap, and the button
 * is only shown when the server says it is open.
 *
 * What comes back is a PROPOSAL: lines of text fed to the same `draftFromRecognisedText` any recogniser would feed, so the numbers arrive
 * in editable boxes beside the photo and nothing is saved until the person has ticked every one (`finalisePhotoReading`).
 */
export type CuffReaderResult =
  | { ok: true; lines: string[]; pulseDropped: boolean }
  | { ok: false; kind: "retake" | "unavailable" | "offline" | "not_open"; message: string };

export const CUFF_READER_COPY = {
  consent: t("cuffcam.consent"),
  button: t("cuffcam.button"),
  working: t("cuffcam.working"),
  retake: t("cuffcam.retake"),
  unavailable: t("cuffcam.unavailable"),
  offline: t("cuffcam.offline"),
  not_open: t("cuffcam.not_open"),
  pulseDropped: t("cuffcam.pulse_dropped"),
  proposed: t("cuffcam.proposed"),
} as const;

/** Map the server's answer to what the screen shows. Pure, so the mapping is tested without a network. */
export function interpretCuffResponse(status: number, body: unknown): CuffReaderResult {
  if (status === 404) return { ok: false, kind: "not_open", message: CUFF_READER_COPY.not_open };
  const b = (body ?? {}) as { status?: string; lines?: unknown; pulse_dropped?: unknown };
  if (status >= 200 && status < 300 && b.status === "proposal" && Array.isArray(b.lines) && b.lines.every((l) => typeof l === "string") && b.lines.length >= 2) {
    return { ok: true, lines: b.lines as string[], pulseDropped: b.pulse_dropped === true };
  }
  if (status >= 200 && status < 300 && b.status === "retake") return { ok: false, kind: "retake", message: CUFF_READER_COPY.retake };
  return { ok: false, kind: "unavailable", message: CUFF_READER_COPY.unavailable };
}

/** Whether to show the button at all. Fails closed: any doubt is "do not show". */
export async function isCuffReaderOpen(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: "cuff_camera_enabled" });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function requestCuffProposal(photoUri: string): Promise<CuffReaderResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, kind: "unavailable", message: CUFF_READER_COPY.unavailable };
  const form = new FormData();
  // React Native's FormData accepts { uri, type, name } for a local file (same shape as labs.ts).
  form.append("photo", { uri: photoUri, type: "image/jpeg", name: "cuff.jpg" } as unknown as Blob);
  try {
    const response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/cuff-display-proposal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: form,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return interpretCuffResponse(response.status, body);
  } catch {
    return { ok: false, kind: "offline", message: CUFF_READER_COPY.offline };
  }
}

/**
 * A proposal belongs to the photo it was asked for. If the person took another photo while the request was in flight, the answer is for a
 * photo they no longer see and must be dropped, never poured into the boxes beside the new photo.
 */
export function proposalIsStale(requestedUri: string, currentUri: string | null): boolean {
  return currentUri !== requestedUri;
}
