import { runPatientDuplicateDetection } from "@/lib/patient-duplicates/run";

/**
 * Weekly sweep for potential duplicate patient records (§34.4). Verifies
 * the Vercel-attached `Authorization: Bearer <CRON_SECRET>` header, same as
 * the other cron routes. Never merges anything — it only refreshes the
 * pending patient_match_candidates queue an admin reviews.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const result = await runPatientDuplicateDetection();
  return Response.json(result);
}
