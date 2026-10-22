import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { requestReadingFor } from "@/lib/document-capture/request-reading";

/**
 * The phone asks for a document photo it has just uploaded to be read into SUGGESTIONS (S43m, spec 2.3). Bearer-authenticated with the mobile
 * session's own JWT; the person comes from the verified token and never from the body. The same function the web screen uses decides everything:
 * the person must own the document, it must be waiting for a reading, and the capture guard (`document_capture_enabled`, off) must be open for
 * them. With the guard closed nothing is sent to any model and the photo is simply kept.
 *
 * The answer carries a status and a plain sentence only. It never carries what was read: the phone reads suggestions back through its own
 * RLS-scoped read when the person opens the confirm screen, and nothing read here is part of the record until the person confirms it.
 */
const bodySchema = z.object({ document_id: z.string().uuid() });

export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "document_id must be a uuid" }, { status: 400 });

  const result = await requestReadingFor(supabase, user.id, parsed.data.document_id);
  if (result.error) {
    // A reading that failed is an ordinary answer (the photo is kept); a document that is not the caller's or not waiting is a not-found.
    if (result.status === "failed") return NextResponse.json({ status: "failed", message: result.error });
    // Already read, confirmed or dropped: an ordinary answer, so the phone can say there is nothing waiting instead of "try again".
    if (result.status === "not_pending") return NextResponse.json({ status: "not_pending", message: result.error });
    return NextResponse.json({ status: "refused", error: result.error }, { status: 404 });
  }
  return NextResponse.json({ status: result.status ?? "suggested", message: result.message ?? "" });
}
