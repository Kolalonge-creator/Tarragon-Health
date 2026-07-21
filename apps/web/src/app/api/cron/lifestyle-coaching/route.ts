import { runLifestyleCoaching } from "@/lib/lifestyle/coaching-run";

/**
 * Daily coaching run (Vercel Cron, see apps/web/vercel.json). Computes
 * per-programme signals (ML trends/engagement, degrading to a local heuristic)
 * and enqueues supportive nudges via the MessagingGateway. Verifies the
 * Vercel-attached `Authorization: Bearer <CRON_SECRET>` header, same as the
 * other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const result = await runLifestyleCoaching();
  return Response.json(result);
}
