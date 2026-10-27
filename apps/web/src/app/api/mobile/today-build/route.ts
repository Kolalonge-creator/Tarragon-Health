import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { answerTodayBuild, todayFactsSchema } from "@/lib/today/today-build-request";

/**
 * Server fallback for `today-build` (S47b): when the phone cannot run the ranking itself it posts what it knows (counts and yes/no facts, never a
 * reading value) and gets back the same plan the phone would have built, with at most two primary actions. `{ state: "hidden" }` means the
 * configuration is not signed: show today's ordinary list.
 */
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
  const parsed = todayFactsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const { data, error } = await supabase.rpc("my_home_card_config");
  const answer = error ? ({ state: "hidden" } as const) : answerTodayBuild(data, parsed.data);
  return NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } });
}
