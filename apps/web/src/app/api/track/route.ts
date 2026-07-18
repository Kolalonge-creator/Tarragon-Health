import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentUser } from "@/lib/supabase/server";
import type { TablesInsert } from "@tarragon/shared";

/**
 * First-party page-view collector for the analytics console (Acquisition +
 * Engagement). The client tracker (components/analytics/page-tracker.tsx) fires
 * a beacon here on each navigation.
 *
 * PRIVACY/NDPR: coarse geo is derived from Vercel's edge headers
 * (x-vercel-ip-country / -country-region / -city) and the raw IP is discarded —
 * it is never read into the row. If the caller sends Do-Not-Track we skip
 * entirely. profile_id is resolved server-side from the session (never trusted
 * from the client). Writes go through the service-role client because web_events
 * has RLS on with no policies (see 20260717192702_web_events_capture.sql).
 */

const bodySchema = z.object({
  path: z.string().min(1).max(2048),
  referrer: z.string().max(2048).optional(),
  utm_source: z.string().max(255).optional(),
  utm_medium: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  session_id: z.string().max(64).optional(),
});

function deviceTypeFromUA(ua: string): "mobile" | "tablet" | "desktop" {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return "mobile";
  return "desktop";
}

function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // Honour Do-Not-Track — record nothing.
  if (request.headers.get("dnt") === "1") {
    return NextResponse.json({ ok: true, skipped: "dnt" });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const body = parsed.data;

  // Coarse geo from Vercel edge headers — the raw IP is intentionally not read.
  const headers = request.headers;
  const country = headers.get("x-vercel-ip-country") || null;
  const region = headers.get("x-vercel-ip-country-region") || null;
  const city = (() => {
    const c = headers.get("x-vercel-ip-city");
    return c ? decodeURIComponent(c) : null;
  })();
  const deviceType = deviceTypeFromUA(headers.get("user-agent") ?? "");

  // profile_id resolved from the session cookie, never trusted from the client.
  const user = await getCurrentUser().catch(() => null);

  const row: TablesInsert<"web_events"> = {
    path: body.path,
    referrer_host: referrerHost(body.referrer),
    utm_source: body.utm_source ?? null,
    utm_medium: body.utm_medium ?? null,
    utm_campaign: body.utm_campaign ?? null,
    country,
    region,
    city,
    device_type: deviceType,
    profile_id: user?.id ?? null,
    session_id: body.session_id ?? null,
  };

  const supabase = createServiceRoleClient();
  // Fire-and-forget semantics: a failed insert must never surface to the user.
  const { error } = await supabase.from("web_events").insert(row);
  if (error) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
