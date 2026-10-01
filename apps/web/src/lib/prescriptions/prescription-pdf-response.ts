import { renderToBuffer } from "@react-pdf/renderer";
import { PrescriptionPdf } from "./prescription-document";
import type { PrescriptionLoadResult } from "./load-prescription-pdf-data";

/** Maps a load result to an HTTP response: the PDF on success, otherwise a plain-text reason the app can show. */
export async function prescriptionPdfResponse(
  result: PrescriptionLoadResult,
  options: { disposition: "attachment" | "inline"; filename: string },
): Promise<Response> {
  if (result.status === "not_found") return new Response("Not found", { status: 404 });
  if (result.status === "refused") return new Response(result.message, { status: 409, headers: { "X-Refusal-Reason": result.reason } });
  if (result.status === "error") return new Response(result.message, { status: 500 });

  const buffer = await renderToBuffer(PrescriptionPdf({ prescriptions: result.prescriptions }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${options.disposition}; filename="${options.filename}"`,
      "Cache-Control": "private, no-store",
      ...(result.skipped.length > 0 ? { "X-Skipped-Prescriptions": String(result.skipped.length) } : {}),
    },
  });
}
