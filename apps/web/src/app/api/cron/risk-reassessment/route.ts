import { runRiskReassessment } from "@/lib/risk-reassessment/run";

/**
 * Daily drain of public.risk_reassessment_queue (Vercel Cron, see
 * apps/web/vercel.json). Verifies the Vercel-attached
 * `Authorization: Bearer <CRON_SECRET>` header, same as the other cron
 * routes (see api/cron/lifestyle-coaching/route.ts).
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const result = await runRiskReassessment();
  return Response.json(result);
}
