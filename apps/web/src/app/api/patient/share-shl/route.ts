import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { issueShlForOwnShare } from "@/lib/my-health/issue-shl";

/**
 * GET /api/patient/share-shl?id=<share id>: the SMART Health Link for one of the signed-in person's own record shares, for pasting into a
 * hospital system. Cookie session. 404 for a share that is not theirs, is gone, or has been revoked, expired or locked (same answer for all);
 * 503 when this deployment has no link secret configured. Never cached.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;
const querySchema = z.object({ id: z.string().uuid() });

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401, headers: NO_STORE });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  const out = await issueShlForOwnShare(supabase, parsed.data.id);
  if (out.ok) return Response.json({ link: out.link }, { headers: NO_STORE });
  return Response.json({ error: out.reason }, { status: out.reason === "not_found" ? 404 : 503, headers: NO_STORE });
}
