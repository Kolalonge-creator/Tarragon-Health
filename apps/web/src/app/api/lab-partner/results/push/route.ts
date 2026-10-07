import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { labPushResponseSchema, labPushSchema } from "@/lib/lab-push/push-schema";
import type { Json } from "@tarragon/shared";

/**
 * POST /api/lab-partner/results/push (S44, spec 2.12). A partner laboratory pushes structured, coded results for one of its own orders.
 *
 * Bearer-authenticated with the laboratory user's own session, like the mobile routes: the database function resolves the laboratory from that
 * session and refuses an order that is not its own, so there is no way to name another laboratory here. Everything that matters happens in
 * `lab_partner_push_result`: an item with no CMO-confirmed LOINC/UCUM mapping rejects the whole push (422, nothing stored as a result); an
 * accepted push uses the S27 writer, so critical or abnormal values are held for a clinician, a reactive HIV, hepatitis B surface antigen or
 * hepatitis C antibody result goes to clinician disclosure, and only a complete all-normal result against signed ranges is released. The
 * answer says "received" and whether it is out or held, never why.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  const supabase = createBearerClient(token);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = labPushSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const { data, error } = await supabase.rpc("lab_partner_push_result", {
    p_order: parsed.data.order_id,
    p_message_id: parsed.data.message_id,
    p_items: parsed.data.items as unknown as Json,
  });
  if (error) {
    // 42501 covers both "not a partner lab" and "not this lab's order": the same answer, so an order's existence is not revealed.
    if (error.code === "42501") return NextResponse.json({ error: "Not permitted" }, { status: 403 });
    if (error.code === "22023") return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    return NextResponse.json({ error: "The results could not be recorded. Please retry." }, { status: 500 });
  }
  const answer = labPushResponseSchema.safeParse(data);
  if (!answer.success) return NextResponse.json({ error: "The results could not be recorded. Please retry." }, { status: 500 });
  return NextResponse.json(answer.data, { status: answer.data.status === "rejected" ? 422 : 200 });
}
