import { createClient } from "@/lib/supabase/server";
import { generateLabRequestPdf } from "@/lib/lab-results/generate-lab-request-pdf";

/**
 * The take-anywhere test request PDF for one lab order.
 *
 * Cookie-session auth, and every read runs through the caller's own RLS-scoped
 * session (via generateLabRequestPdf) — lab_orders_select only admits the
 * patient themselves, org staff, or a consented clinical reader, so a foreign
 * orderId simply returns nothing and this 404s rather than leaking that the
 * order exists.
 *
 * Never gated by plan: a patient holding an open request must always be able
 * to print it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const result = await generateLabRequestPdf(supabase, orderId);
  if (!result.ok) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
