import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * GET /api/media/{code}/stream: the bytes of one meditation, sleep story or soundscape, for a signed-in person the catalogue allows to
 * play it. The recordings live in the PRIVATE `audio` bucket. There is no public address, no link to share and nothing is cached or
 * offered as a file (founder, 2026-10-23: stream on the platform only).
 *
 * 1. The catalogue row is read AS THE PERSON, so the rule in media_library's own policy decides: a patient gets only an item that is
 *    active, published, not a placeholder and not past its review date; an admin can also preview a draft.
 * 2. The file is then fetched with the service role through a 60-second signed address and passed on with the Range header, so a player
 *    can seek and a sleep story can resume.
 * 3. A request that comes from opening the address as a page (Sec-Fetch-Dest: document or iframe) is refused, so it cannot be saved from
 *    a browser tab. Anything that plays in an audio element is allowed.
 * A person can still record what plays; nothing here offers, links or caches a file.
 */
// A long sleep story can take longer than the default limit to pass on to a slow connection.
export const maxDuration = 60;

const BUCKET = "audio";
const CODE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const AUDIO_KINDS = new Set(["meditation", "sleep_story", "soundscape"]);
const BASE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

const reply = (status: number, body: string) => new Response(body, { status, headers: BASE_HEADERS });

export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await ctx.params;
  if (!CODE.test(code)) return reply(404, "Not found");

  const dest = request.headers.get("sec-fetch-dest");
  if (dest === "document" || dest === "iframe" || dest === "embed" || dest === "object") return reply(403, "Not available");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return reply(401, "Sign in to listen");

  const { data: item, error } = await supabase.from("media_library").select("kind, audio_url").eq("code", code).maybeSingle();
  if (error) return reply(502, "Could not load this recording");
  const path = item?.audio_url ?? "";
  if (!item || !AUDIO_KINDS.has(item.kind) || !path.startsWith("media-library/") || path.includes("..")) return reply(404, "Not found");

  const service = createServiceRoleClient();
  const { data: signed, error: signError } = await service.storage.from(BUCKET).createSignedUrl(path, 60);
  if (signError || !signed?.signedUrl) return reply(404, "Not found");

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(signed.signedUrl, { headers: range ? { range } : {}, cache: "no-store" });
  } catch {
    return reply(502, "Could not load this recording");
  }
  if (upstream.status !== 200 && upstream.status !== 206) return reply(upstream.status === 416 ? 416 : 404, "Not found");

  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", "audio/mpeg");
  headers.set("Content-Disposition", "inline");
  headers.set("Accept-Ranges", "bytes");
  for (const name of ["content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
