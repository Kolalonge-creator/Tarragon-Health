import { createClient } from "@/lib/supabase/server";
import { generateImagingRequestPdf } from "@/lib/imaging-orders/generate-imaging-request-pdf";

/**
 * The take-anywhere imaging request PDF for one order (diagnostic directory Phase 5). Cookie session; every read is the
 * caller's own RLS, so a foreign order id is a 404 that does not reveal the order exists.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const { orderId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const result = await generateImagingRequestPdf(supabase, orderId);
  if (!result.ok) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(result.buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${result.filename}"` },
  });
}
