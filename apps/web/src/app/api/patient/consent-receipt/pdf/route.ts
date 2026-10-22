import { renderToBuffer } from "@react-pdf/renderer";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildConsentReceipt, parseConsentReceiptData, receiptFileName } from "@/lib/consent/consent-receipt";
import { ConsentReceiptDocument } from "@/lib/consent/consent-receipt-document";

/**
 * Streams the caller's OWN consent receipt as a one-page PDF (RCPT-1): `?scope=all` for the current picture, or
 * `?scope=matrix_event&id=<id>` / `?scope=document_event&id=<id>` for one change.
 *
 * The one database function behind it (`consent_receipt_data`) reads only the caller's own consent history, refuses every role but an active
 * patient, and writes the audit row in the same call, so there is no download without an audit row. This route has no patient argument. It adds
 * no health data (there is none in the source) and the file name carries nothing about the person.
 */
const querySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("matrix_event"), id: z.string().uuid() }),
  z.object({ scope: z.literal("document_event"), id: z.string().uuid() }),
]);

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ scope: url.searchParams.get("scope") ?? "all", id: url.searchParams.get("id") ?? undefined });
  if (!parsed.success) return new Response("Invalid request", { status: 400 });

  const { data, error } = await supabase.rpc("consent_receipt_data", {
    p_scope: parsed.data.scope,
    p_ref: parsed.data.scope === "all" ? undefined : parsed.data.id,
  });
  if (error) {
    // not a patient, or not the caller's own: the same answer, so nothing about who owns what is revealed
    if (error.code === "42501" || error.code === "P0002") return new Response("Not found", { status: 404 });
    if (error.code === "22023") return new Response("Invalid request", { status: 400 });
    Sentry.captureMessage("consent_receipt_data failed", { level: "warning", tags: { pg_code: error.code ?? "none" } });
    return new Response("Could not prepare the receipt", { status: 503 });
  }

  const receipt = parseConsentReceiptData(data);
  if (!receipt) {
    // the database and the schema here have drifted apart: loud, never a shorter receipt
    Sentry.captureMessage("consent_receipt_data answer did not match the schema", { level: "error" });
    return new Response("Could not prepare the receipt", { status: 503 });
  }

  const buffer = await renderToBuffer(ConsentReceiptDocument({ view: buildConsentReceipt(receipt, "en") }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receiptFileName()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
