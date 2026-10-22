import { API_BASE_URL, fetchWithTimeoutAndRetry } from "./api";
import { supabase } from "./supabase";

/**
 * Result passport on the phone (item 10): builds the PDF on the server (the same builder as the web page) and keeps a COPY ON THE PHONE, so
 * it can be shown at a clinic with no signal. The person chooses the sections; nothing is built until they tap. The copy lives in the app's
 * own document folder (not the photo library, not a cloud backup folder the app controls) and the person can delete it.
 *
 * NEEDS A NATIVE BUILD to run on a real phone: `expo-file-system`'s native module must be in the installed binary. Where it is missing
 * `savePassportCopy` reports `unavailable` and the person is pointed at the web page; nothing else in the app is affected.
 */
export type PassportSection = "allergies_conditions" | "medicines" | "bp" | "bp_chart" | "glucose" | "lab_results";

export const PASSPORT_SECTIONS: { id: PassportSection; label: string }[] = [
  { id: "allergies_conditions", label: "Allergies and ongoing conditions" },
  { id: "medicines", label: "Current medicines and their schedule" },
  { id: "bp", label: "Blood pressure readings and average" },
  { id: "bp_chart", label: "Blood pressure chart" },
  { id: "glucose", label: "Blood sugar readings" },
  { id: "lab_results", label: "Latest lab results" },
];

export const PASSPORT_DEFAULT_ON: readonly PassportSection[] = ["allergies_conditions", "medicines", "bp", "glucose", "lab_results"];
export const PASSPORT_PERIOD_DAYS = [30, 90, 180] as const;

export type SavePassportResult =
  | { ok: true; uri: string; name: string }
  | { ok: false; kind: "not_open" | "offline" | "failed" | "unavailable" };

/** `result-passport-YYYY-MM-DD.pdf`, from the Lagos calendar date, so two copies on the same day replace each other rather than pile up. */
export function passportFileName(now: Date): string {
  const lagos = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `result-passport-${lagos}.pdf`;
}

/** The request body. Pure, so it is tested without a network. At least one section is always sent. */
export function passportRequestBody(sections: readonly PassportSection[], days: number): { days: number; sections: PassportSection[] } {
  const known = new Set(PASSPORT_SECTIONS.map((s) => s.id));
  const picked = [...new Set(sections)].filter((s) => known.has(s));
  return { days, sections: picked };
}

type FsModule = typeof import("expo-file-system");

function loadFs(): FsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-file-system") as FsModule;
  } catch {
    return null;
  }
}

export async function isPassportOpen(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: "result_passport_enabled" });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function savePassportCopy(sections: readonly PassportSection[], days: number, now: Date = new Date()): Promise<SavePassportResult> {
  const fs = loadFs();
  if (!fs) return { ok: false, kind: "unavailable" };
  const body = passportRequestBody(sections, days);
  if (body.sections.length === 0) return { ok: false, kind: "failed" };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, kind: "failed" };
  let response: Response;
  try {
    response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/result-passport/pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: "offline" };
  }
  if (response.status === 404) return { ok: false, kind: "not_open" };
  if (!response.ok) return { ok: false, kind: "failed" };
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A PDF starts with "%PDF-". Anything else (an error page from a proxy) is never saved as if it were the passport.
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, kind: "failed" };
    const dir = new fs.Directory(fs.Paths.document, "result-passports");
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const name = passportFileName(now);
    const file = new fs.File(dir, name);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return { ok: true, uri: file.uri, name };
  } catch {
    return { ok: false, kind: "failed" };
  }
}
