import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentUser } from "@/lib/supabase/server";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Funnel events from the web app (Front Desk F6): a signed-in person viewed pricing, started checkout, took an onboarding step or opened the
 * app. They cancel follow-ups whose goal they are (a person who started checkout needs no "finish signing up" nudge) and feed the Friday
 * report. The user id comes from the session, never from the body. Only four event types are accepted; the server enforces that too.
 *
 * Failing to record an event must never affect the person, so the response carries no detail and the caller ignores it.
 */
const bodySchema = z.object({
  type: z.enum(["onboarding_step", "pricing_viewed", "checkout_started", "app_active"]),
  step: z.string().trim().max(60).optional(),
  /** Lets a retried request record once. Defaults to one per event type per day. */
  key: z.string().trim().min(3).max(200).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const limited = await rateLimit(`fd-events:${user.id}`, { limit: 60, windowSeconds: 60 });
  if (!limited.success) return new NextResponse(null, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const { error } = await fdRpcData(createServiceRoleClient(), "service_fd_record_event", {
    p_user: user.id,
    p_type: parsed.data.type,
    p_step: parsed.data.step ?? null,
    p_key: parsed.data.key ?? null,
  });
  return new NextResponse(null, { status: error ? 500 : 204 });
}
