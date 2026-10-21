import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadEmergencyDatasetForPatient } from "./dataset";
import { applyCardFieldChoices, choicesFromRow, hiddenFields } from "./field-choices";
import { buildEmergencyQrText } from "./qr-text";
import { emergencyTextQrSvg } from "./qr-render";
import {
  buildLockScreenModel,
  LOCK_SCREEN_FILE_NAME,
  LOCK_SCREEN_IMAGE,
  lockScreenChoices,
  type LockScreenOptions,
} from "./lock-screen-image";
import { LockScreenCardImage } from "./lock-screen-image-view";

/**
 * Draws the caller's own emergency card as a lock-screen picture (LSI-1). Shared by the web route (cookie session) and the mobile route (bearer
 * token); both pass an RLS-scoped client, so every read is the caller's own.
 *
 * Order matters and is the safety of this file:
 *   1. the person's own switch (`lock_screen_opt_in`) must be on, or nothing is read and the answer is 403;
 *   2. the audit door (`record_emergency_card_image`) is called BEFORE anything is drawn, so no picture exists without its audit row;
 *   3. only then are the facts loaded and passed through the card chooser (and, by default, the minimum), so the picture can show no more than
 *      the printed card does.
 * The file name and the audit row carry nothing about the person or what the card holds. The picture is never cached.
 */

const FONTS_DIR = path.join(process.cwd(), "src/lib/pdf/fonts");

let fontCache: { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[] | null = null;

/** Read once per process. Loaded BEFORE the audit row is written, so a missing font file can never leave a row for a picture that was not made. */
function loadFonts() {
  if (fontCache) return fontCache;
  const read = (file: string): ArrayBuffer => {
    const buf = readFileSync(path.join(FONTS_DIR, file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  fontCache = [
    { name: "Noto Sans", data: read("NotoSans-Regular.ttf"), weight: 400, style: "normal" },
    { name: "Noto Sans", data: read("NotoSans-Bold.ttf"), weight: 700, style: "normal" },
  ];
  return fontCache;
}

export interface LockScreenImageRequest {
  supabase: SupabaseClient<Database>;
  userId: string;
  options: LockScreenOptions;
  /** "attachment" for the web download link; "inline" for the phone, where the picture is shown in the in-app browser to be pressed and held. */
  disposition?: "attachment" | "inline";
}

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function lockScreenImageResponse({ supabase, userId, options, disposition = "attachment" }: LockScreenImageRequest): Promise<Response> {
  let fonts;
  try {
    fonts = loadFonts();
  } catch {
    return new Response("Could not prepare the picture", { status: 503, headers: NO_STORE });
  }

  const { data: fieldsRow, error: fieldsError } = await supabase
    .from("emergency_card_fields")
    .select(
      "show_date_of_birth, show_sex, show_patient_number, show_allergies, show_medications, show_conditions, show_blood, show_emergency_contact, show_reproductive, show_mental_health, lock_screen_opt_in",
    )
    .eq("patient_id", userId)
    .maybeSingle();
  if (fieldsError) return new Response("Could not prepare the picture", { status: 503, headers: NO_STORE });
  // off unless the person turned it on: nothing else is read
  if (!fieldsRow || fieldsRow.lock_screen_opt_in !== true) return new Response("Lock screen picture is off", { status: 403, headers: NO_STORE });

  const { error: auditError } = await supabase.rpc("record_emergency_card_image", { p_include_qr: options.includeQr, p_minimum: options.minimum });
  if (auditError) {
    if (auditError.code === "42501") return new Response("Lock screen picture is off", { status: 403, headers: NO_STORE });
    return new Response("Could not prepare the picture", { status: 503, headers: NO_STORE });
  }

  const choices = lockScreenChoices(choicesFromRow(fieldsRow), options.minimum);
  let full;
  try {
    full = await loadEmergencyDatasetForPatient(supabase, userId, { strict: true });
  } catch {
    // never a picture that says "None recorded" because a read failed
    return new Response("Could not prepare the picture", { status: 503, headers: NO_STORE });
  }
  const facts = applyCardFieldChoices(full, choices);
  const hidden = hiddenFields(choices);

  const savedOn = new Date().toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
  const model = buildLockScreenModel(facts, hidden, savedOn);

  let qrDataUri: string | null = null;
  if (options.includeQr) {
    const svg = await emergencyTextQrSvg(buildEmergencyQrText(facts, savedOn, hidden));
    // a missing QR is a picture without one, never a failed picture: every fact is already written on it
    if (svg) qrDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const image = new ImageResponse(<LockScreenCardImage model={model} qrDataUri={qrDataUri} />, {
    width: LOCK_SCREEN_IMAGE.width,
    height: LOCK_SCREEN_IMAGE.height,
    fonts,
    headers: {
      ...NO_STORE,
      "Content-Disposition": `${disposition}; filename="${LOCK_SCREEN_FILE_NAME}"`,
    },
  });
  return image;
}

/** Reads the two options from a query string. Both default ON (the safe side: the minimum, and a QR that holds no more than the picture does). */
export function lockScreenOptionsFromUrl(url: URL): LockScreenOptions {
  return { includeQr: url.searchParams.get("qr") !== "0", minimum: url.searchParams.get("minimum") !== "0" };
}
