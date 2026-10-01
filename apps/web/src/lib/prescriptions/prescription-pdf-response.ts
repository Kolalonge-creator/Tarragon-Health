import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { PrescriptionPdf } from "./prescription-document";
import type { PrescriptionLoadResult } from "./load-prescription-pdf-data";
import { prescriptionVerifyUrl } from "./verify-url";

/** A missing QR is a degraded document, never a failed download: the Rx number and code are printed in full beside it. */
async function qrFor(publicToken: string | null): Promise<string | null> {
  if (!publicToken) return null;
  try {
    return await QRCode.toDataURL(prescriptionVerifyUrl(publicToken), { errorCorrectionLevel: "M", margin: 1, width: 240 });
  } catch {
    return null;
  }
}

/** Maps a load result to an HTTP response: the PDF on success, otherwise a plain-text reason the app can show. */
export async function prescriptionPdfResponse(
  result: PrescriptionLoadResult,
  options: { disposition: "attachment" | "inline"; filename: string },
): Promise<Response> {
  if (result.status === "not_found") return new Response("Not found", { status: 404 });
  if (result.status === "refused") return new Response(result.message, { status: 409, headers: { "X-Refusal-Reason": result.reason } });
  if (result.status === "error") return new Response(result.message, { status: 500 });

  const qrByMedicationId: Record<string, string> = {};
  for (const rx of result.prescriptions) {
    const qr = await qrFor(rx.publicToken);
    if (qr) qrByMedicationId[rx.medicationId] = qr;
  }
  const buffer = await renderToBuffer(
    PrescriptionPdf({
      prescriptions: result.prescriptions,
      skipped: result.skipped,
      qrByMedicationId,
      letterhead: result.letterhead,
    }),
  );
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${options.disposition}; filename="${options.filename}"`,
      "Cache-Control": "private, no-store",
      ...(result.skipped.length > 0 ? { "X-Skipped-Prescriptions": String(result.skipped.length) } : {}),
    },
  });
}
