import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { issueShlForOwnShare } from "@/lib/my-health/issue-shl";

/**
 * GET /api/mobile/share-shl?id=<share id>: the phone's twin of /api/patient/share-shl. Identity comes from the verified bearer token, never
 * from the query; the share is read as that person, so someone else's share id is a 404.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;
const querySchema = z.object({ id: z.string().uuid() });

export async function GET(request: Request): Promise<Response> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return Response.json({ error: "Missing bearer token" }, { status: 401, headers: NO_STORE });
  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return Response.json({ error: "Invalid or expired session" }, { status: 401, headers: NO_STORE });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  const out = await issueShlForOwnShare(supabase, parsed.data.id);
  if (out.ok) return Response.json({ link: out.link }, { headers: NO_STORE });
  return Response.json({ error: out.reason }, { status: out.reason === "not_found" ? 404 : 503, headers: NO_STORE });
}
