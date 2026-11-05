import { isCronAuthorised } from "@/lib/cron-auth";
import { populateContentEmbeddings } from "@/lib/lifestyle/embed-content";
import { createVoyageEmbedderFromEnv } from "@/lib/lifestyle/voyage-embedder";
import { embeddingCronSkip } from "@/lib/lifestyle/embedding-cron-gate";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Daily content-embedding run (Vercel Cron, see apps/web/vercel.json).
 * Embeds any lpe_content_blocks row with `embedding is null` via Voyage AI —
 * a graceful no-op (`reason: "no_embedder_configured"`) until VOYAGE_API_KEY
 * is set. Verifies the Vercel-attached `Authorization: Bearer <CRON_SECRET>`
 * header, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!isCronAuthorised(authHeader)) {
    return new Response("Not authorised", { status: 401 });
  }

  // AI-009 kill switch (audit G-08): switched off in the registry means no provider call from this cron either.
  const skip = await embeddingCronSkip(createServiceRoleClient());
  if (skip) return Response.json(skip);

  const embedder = createVoyageEmbedderFromEnv() ?? undefined;
  const result = await populateContentEmbeddings(embedder);
  return Response.json(result);
}
