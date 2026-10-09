import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { authenticateCommunity } from "@/lib/community/api-auth";

/**
 * GET /api/community/images/{id}: the bytes of one picture, only for someone the database says may see it (community_image_ref):
 * a member of the group once the post is published, the author while it waits, the group's moderators, a safety reviewer for a safety
 * post. The file is streamed through here; there is no link to share, and nothing is cached.
 */
const refSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), path: z.string(), mime: z.enum(["image/jpeg", "image/png"]) }),
  z.object({ ok: z.literal(false), reason: z.string().optional() }),
]);

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const auth = await authenticateCommunity(request);
  if ("response" in auth) return auth.response;

  const { data, error } = await auth.supabase.rpc("community_image_ref", { p_image_id: id });
  const ref = refSchema.safeParse(data);
  if (error || !ref.success || !ref.data.ok) return new Response("Not found", { status: 404 });

  const { data: blob, error: downloadError } = await createServiceRoleClient().storage.from("community-images").download(ref.data.path);
  if (downloadError || !blob) return new Response("Not found", { status: 404 });
  return new Response(blob, {
    headers: {
      "Content-Type": ref.data.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
