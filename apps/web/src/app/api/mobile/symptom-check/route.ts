import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { getActiveTriageProtocolConfig, isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import { readEligibility, runSymptomStep } from "@/lib/symptom-triage/run-step";
import { symptomTriageStepSchema } from "@/lib/validation/symptom-triage";
import { SEED_PATHWAYS } from "@tarragon/symptom-triage-engine";

/**
 * S59b: the mobile symptom checker's server side. Bearer-authenticated, and it REUSES the web's `runSymptomStep` (the same
 * fail-toward-escalation wrapper, the same tightening layers, the same recording and escalation), never a copy. The check is for the
 * signed-in person only: a carer answering for someone else uses the web. Behind the `symptom_checker_enabled` guard and FAILS CLOSED:
 * any error reading the guard, the protocol or the person's eligibility reads as "not open". The on-device red-flag floor does not
 * depend on this route at all (INV-06).
 *
 * GET  -> { open, complaints, eligibility }   what the screen may offer
 * POST -> one step, exactly the web's SymptomTriageStepResult
 */
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
  const closed = NextResponse.json({ open: false, complaints: [], eligibility: "error" });
  try {
    if (!(await isSymptomCheckerOpen(auth.supabase))) return closed;
    const active = await getActiveTriageProtocolConfig(auth.supabase);
    if (!active) return closed;
    const eligibility = await readEligibility(auth.supabase, auth.user.id);
    return NextResponse.json({
      open: true,
      eligibility,
      complaints: active.config.pathways.map((p) => ({
        key: p.key,
        label: p.label,
        // the vocabulary the on-device screen shows: the bundled copy, so it works with no connection
        bundledCurrent: JSON.stringify(SEED_PATHWAYS.find((s) => s.key === p.key) ?? null) === JSON.stringify(p),
      })),
    });
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
  const parsed = symptomTriageStepSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const result = await runSymptomStep(parsed.data, { supabase: auth.supabase, userId: auth.user.id, resolveSubjectId: async (id) => id });
    return NextResponse.json(result);
  } catch {
    // never an empty answer for a patient: the app falls back to its own on-device result when this is not a 200
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
