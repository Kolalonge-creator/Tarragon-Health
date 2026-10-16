import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { sessionIdFromAccessToken, verifyPasswordAndRecordStepUp } from "@/lib/account/step-up";

/**
 * Backup codes for the native app (S03b follow-up, OQ-S03B-04). The phone calls this with its own session token; it is the
 * mobile twin of the web card and reuses the SAME server logic, so there is no weaker path:
 *
 *  - POST makes ten new codes. It needs the account password again (verifyPasswordAndRecordStepUp: the password is checked
 *    here, the step-up is recorded for THIS session only, single-use, a few minutes), and then public.generate_backup_codes
 *    runs as the caller, which itself refuses without that step-up, rate-limits regeneration per day and ends the old set.
 *  - GET returns only the counts (public.my_backup_code_status). The codes are never readable again after POST.
 *
 * Identity always comes from the verified token (auth.getUser), never from the body. Responses are never cached.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;
const bodySchema = z.object({ password: z.string().min(1).max(256) });

type AuthedUser = NonNullable<Awaited<ReturnType<ReturnType<typeof createBearerClient>["auth"]["getUser"]>>["data"]["user"]>;

async function authenticate(request: Request): Promise<{ accessToken: string; user: AuthedUser } | { response: NextResponse }> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return { response: NextResponse.json({ error: "Missing bearer token" }, { status: 401, headers: NO_STORE }) };
  const {
    data: { user },
    error,
  } = await createBearerClient(accessToken).auth.getUser(accessToken);
  if (error || !user) return { response: NextResponse.json({ error: "Invalid or expired session" }, { status: 401, headers: NO_STORE }) };
  return { accessToken, user };
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { data, error } = await createBearerClient(auth.accessToken).rpc("my_backup_code_status");
  const s = data as { total?: unknown; remaining?: unknown; generated_at?: unknown } | null;
  // An unreadable answer is an error, never "you have no codes": that would tell a person with a working set they have none.
  if (error || !s || typeof s.total !== "number" || typeof s.remaining !== "number") {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(
    { total: s.total, remaining: s.remaining, generatedAt: typeof s.generated_at === "string" ? s.generated_at : null },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400, headers: NO_STORE });

  const stepUp = await verifyPasswordAndRecordStepUp(
    auth.user,
    parsed.data.password,
    "backup_codes",
    sessionIdFromAccessToken(auth.accessToken),
  );
  if (!stepUp.ok) {
    const status = stepUp.reason === "rate_limited" ? 429 : stepUp.reason === "unavailable" ? 503 : 400;
    return NextResponse.json({ ok: false, reason: stepUp.reason }, { status, headers: NO_STORE });
  }

  const { data, error } = await createBearerClient(auth.accessToken).rpc("generate_backup_codes");
  if (error) {
    if (/backup_codes_rate_limited/.test(error.message)) {
      return NextResponse.json({ ok: false, reason: "daily_limit" }, { status: 429, headers: NO_STORE });
    }
    // After the password step-up: the set may or may not have been made, so the phone is told to check the count.
    return NextResponse.json({ ok: false, reason: "generation_failed" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, codes: data ?? [] }, { headers: NO_STORE });
}
