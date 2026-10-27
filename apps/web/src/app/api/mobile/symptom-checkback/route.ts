import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import { answerCheckback, readCheckbackView } from "@/lib/symptom-checkback/answer";

/**
 * S59c: the mobile follow-up after a symptom check. Bearer-authenticated; it REUSES the web's `answerCheckback` (the same floor re-run from
 * the stored answers, the same database decision table and alert), never a copy. Behind the `symptom_checker_enabled` guard and FAILS
 * CLOSED: any error reading the guard reads as "not open". The on-device red-flag floor does not depend on this route at all (INV-06).
 * The follow-up is for the signed-in person only.
 *
 * GET            -> { open, checkbacks: [{ id }] }       the follow-ups waiting for an answer (for the banner)
 * GET ?id=<uuid> -> { open, view }                        one follow-up with the original answers and the pathway's sign vocabulary
 * POST           -> SubmitCheckbackResult                 { checkbackId, progress, care?, signs } -> the outcome, or a short reason code
 */
type Reader = {
  from(table: string): {
    select(cols: string): { eq(col: string, v: string): { order(col: string): { limit(n: number): PromiseLike<{ data: { id: string }[] | null; error: unknown }> } } };
  };
};

async function authenticate(request: Request) {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return { ok: false, res: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }) } as const;
  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return { ok: false, res: NextResponse.json({ error: "Invalid or expired session" }, { status: 401 }) } as const;
  return { ok: true, supabase, user } as const;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.res;
  const closed = NextResponse.json({ open: false, checkbacks: [], view: null });
  try {
    if (!(await isSymptomCheckerOpen(auth.supabase))) return closed;
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const view = await readCheckbackView(auth.supabase, id);
      return NextResponse.json({ open: true, view });
    }
    const { data, error } = await (auth.supabase as unknown as Reader).from("symptom_checkbacks").select("id").eq("state", "open").order("due_at").limit(5);
    if (error) return closed;
    return NextResponse.json({ open: true, checkbacks: (data ?? []).map((r) => ({ id: r.id })) });
  } catch {
    return closed;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.res;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const result = await answerCheckback(auth.supabase, auth.user.id, body);
    // a refusal is a normal answer with a short reason code; the phone shows its own calm text for it
    return NextResponse.json(result);
  } catch {
    // never an empty answer for a patient: the phone shows its own "could not send" text, which points to the safe routes
    return NextResponse.json({ ok: false, reason: "failed" }, { status: 503 });
  }
}
