import "server-only";
import QRCode from "qrcode";

/**
 * The emergency card's shared shape and its QR rendering.
 *
 * The payload type mirrors `public.emergency_card_by_token` exactly. If that
 * function's jsonb_build_object ever changes, this type is where it must be
 * reflected — the DB test (packages/db/tests/emergency_cards.sql) asserts the
 * key set, so the two cannot drift silently.
 */

export interface EmergencyCardPayload {
  full_name: string | null;
  date_of_birth: string | null;
  sex: string | null;
  patient_number: string | null;
  emergency_contact: {
    name: string | null;
    phone: string | null;
    relationship: string | null;
  } | null;
  allergies: { allergen: string; reaction: string | null; severity: string | null }[];
  medications: { drug_name: string; dose: string | null; frequency: string | null }[];
  conditions: string[];
  blood: {
    blood_group: string | null;
    genotype: string | null;
    note: string | null;
    source: string | null;
  } | null;
  issued_at: string;
  source: string;
}

/** The URL a scanned QR code opens. */
export function emergencyCardUrl(token: string): string {
  const base =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://app.tarragonhealth.ng";
  return `${base.replace(/\/$/, "")}/emergency/${token}`;
}

/**
 * Render the card URL as an inline SVG QR code.
 *
 * SVG rather than a PNG data URI so it prints crisply at any size — the point
 * of this card is that it survives being printed, folded into a wallet, and
 * scanned in bad light by a stranger. Error correction is set high for the same
 * reason: a creased or smudged card should still scan.
 */
export async function emergencyCardQrSvg(token: string): Promise<string | null> {
  try {
    return await QRCode.toString(emergencyCardUrl(token), {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 1,
      width: 220,
    });
  } catch {
    // A missing QR is a degraded card, never a broken page — the token is also
    // printed as text underneath for exactly this case.
    return null;
  }
}

export const GENOTYPE_NOTE: Record<string, string> = {
  SS: "Sickle cell disease",
  SC: "Sickle cell disease (HbSC)",
  AS: "Sickle cell trait",
  AC: "Haemoglobin C trait",
  CC: "Haemoglobin C disease",
};

export const BLOOD_SOURCE_LABEL: Record<string, string> = {
  lab_result: "from a lab result",
  patient_reported: "as reported by the patient",
  clinician_recorded: "recorded by a clinician",
};
