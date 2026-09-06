import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { InvoiceDocument, type InvoiceDocumentData, type InvoiceLetterhead } from "@/lib/invoices/invoice-document";

const paramsSchema = z.object({
  serviceType: z.enum(["membership", "laboratory", "pharmacy", "referral", "consultation", "care_voucher"]),
  sourceId: z.string().uuid(),
});

/**
 * PDF invoice for one payment (spec §25.6), built on top of get_or_create_invoice
 * (20260829004654_patient_invoices.sql) — the RPC is the real authorization
 * boundary (it only returns a row for a payment that appears in the caller's
 * own patient_receipts()), this route just renders whatever it returns.
 * Idempotent: re-downloading always renders the same invoice_number/totals,
 * since the RPC returns the existing row on every call after the first.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serviceType: string; sourceId: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return new Response("Not found", { status: 404 });
  }
  const { serviceType, sourceId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, patient_number, phone")
    .eq("id", user.id)
    .maybeSingle();

  const { data: invoice, error } = await supabase.rpc("get_or_create_invoice", {
    p_service_type: serviceType,
    p_source_id: sourceId,
  });
  if (error || !invoice) {
    return new Response(error?.message ?? "Not found", { status: 404 });
  }

  const { data: letterheadRaw } = await supabase.rpc("invoice_letterhead_details");
  const letterhead = (letterheadRaw ?? {}) as Partial<InvoiceLetterhead>;

  const buffer = await renderToBuffer(
    InvoiceDocument({
      invoice: invoice as unknown as InvoiceDocumentData,
      billTo: {
        name: profile?.full_name ?? "Patient",
        patientNumber: profile?.patient_number ?? null,
        phone: profile?.phone ?? null,
      },
      letterhead: {
        legal_name: letterhead.legal_name ?? null,
        trading_name: letterhead.trading_name ?? null,
        rc_number: letterhead.rc_number ?? null,
        tin: letterhead.tin ?? null,
        vat_registration_number: letterhead.vat_registration_number ?? null,
        registered_address: letterhead.registered_address ?? null,
        registered_email: letterhead.registered_email ?? null,
        registered_phone: letterhead.registered_phone ?? null,
      },
    }),
  );

  const invoiceNumber = (invoice as unknown as InvoiceDocumentData).invoice_number;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceNumber}.pdf"`,
    },
  });
}
