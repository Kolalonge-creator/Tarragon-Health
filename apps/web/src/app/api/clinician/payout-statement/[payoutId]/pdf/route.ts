import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { statementSchema } from "@/lib/earnings/disputes";
import { PayoutStatementDocument } from "@/lib/earnings/payout-statement-document";

/**
 * Streams the signed-in contracted clinician's statement for one of their own payouts as a PDF (S30b, OQ-200). It is read through
 * `my_payout_statement`, which returns only the caller's own payout that has left the draft state, so it can show nothing the clinician
 * could not already see on their payouts page. A failed read is an error, never an empty statement.
 */
export async function GET(_request: Request, context: { params: Promise<{ payoutId: string }> }): Promise<Response> {
  const { payoutId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payoutId)) return new Response("Invalid payout", { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data, error } = await supabase.rpc("my_payout_statement", { p_payout: payoutId });
  if (error) {
    if (error.message.includes("payout_unknown") || error.message.includes("earnings_not_contracted")) return new Response("Not found", { status: 404 });
    return new Response("Could not load the statement", { status: 503 });
  }
  const parsed = statementSchema.safeParse(data);
  if (!parsed.success) return new Response("Could not read the statement", { status: 503 });

  const buffer = await renderToBuffer(PayoutStatementDocument({ statement: parsed.data }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payout-statement-${parsed.data.period_end}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
