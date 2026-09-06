import { populateHealthEducationEmbeddings } from "@/lib/ai-coach/knowledge-base";
import { createVoyageEmbedderFromEnv } from "@/lib/lifestyle/voyage-embedder";

/**
 * Daily content-embedding run for health_education_content (see
 * apps/web/src/app/api/cron/lpe-embed-content/route.ts, which this
 * mirrors for the AI Coach's second approved-content source). Embeds any
 * clinician_reviewed row with `embedding is null` via Voyage AI — a
 * graceful no-op (`reason: "no_embedder_configured"`) until VOYAGE_API_KEY
 * is set. Verifies the Vercel-attached `Authorization: Bearer
 * <CRON_SECRET>` header, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const embedder = createVoyageEmbedderFromEnv() ?? undefined;
  const result = await populateHealthEducationEmbeddings(embedder);
  return Response.json(result);
}
