import { runDataQualityScan } from "@/lib/data-quality/run";

/**
 * Daily sweep for data-quality findings (§34.14): missing identity fields,
 * unreviewed implausible vitals, pending duplicate-patient candidates,
 * recent source-precedence conflicts, and overdue condition reviews.
 * Verifies the Vercel-attached `Authorization: Bearer <CRON_SECRET>`
 * header, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const result = await runDataQualityScan();
  return Response.json(result);
}
