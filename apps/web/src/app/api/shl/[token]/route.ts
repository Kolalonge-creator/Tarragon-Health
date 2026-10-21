import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKeyFromHeaders, isWellFormedPin, openShare } from "@/lib/my-health/open-share";
import { buildSharedRecordBundle } from "@/lib/my-health/share-fhir";
import { buildManifest, deriveShlKey, ShlTooLarge } from "@/lib/my-health/smart-health-link";
import type { SharedData } from "@/app/share/[token]/shared-record-view";

/**
 * SMART Health Link manifest for a shared record. A hospital system that was given the `shlink:/` string POSTs here (the PIN, when the link
 * has one, goes in the body as `passcode`, never in a URL) and gets one encrypted FHIR file back.
 *
 * It is the same door as the web link: `openShare` calls `record_share_by_token`, so the PIN check, the wrong-PIN lockout, the view cap, the
 * date window, expiry, revoke and the access log are the database's, not re-implemented here. Every answer that is not a manifest is
 * deliberately plain: 404 covers unknown, revoked, expired, closed and locked alike, so a caller cannot tell which.
 *
 * Open to any origin on purpose: a browser-based viewer reads this from its own page. There is no cookie and no ambient authority here, the
 * link itself (token + PIN) is the whole credential, exactly as on /share/[token].
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;
const HEADERS = { ...NO_STORE, ...CORS } as const;

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
/** A manifest request is a few small fields. Anything bigger is not one. */
const MAX_BODY_BYTES = 4096;
const bodySchema = z.object({
  recipient: z.string().max(256).optional(),
  passcode: z.string().max(64).optional(),
  embeddedLengthMax: z.number().int().positive().optional(),
});

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  if (!TOKEN.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });

  // No server secret means no link could ever have been issued with a key this server can rebuild. Say so; never answer unencrypted.
  const key = deriveShlKey(token);
  if (!key) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: HEADERS });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: "invalid" }, { status: 413, headers: HEADERS });
  let json: unknown = {};
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "invalid" }, { status: 413, headers: HEADERS });
  if (raw.trim().length > 0) {
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid" }, { status: 400, headers: HEADERS });
    }
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400, headers: HEADERS });

  const passcode = parsed.data.passcode?.trim() || null;
  // A passcode that cannot be a PIN is refused here and never reaches the database, so it cannot cost the link a wrong-PIN attempt.
  if (passcode && !isWellFormedPin(passcode)) {
    return NextResponse.json({ remainingAttempts: null }, { status: 401, headers: HEADERS });
  }

  const result = await openShare(token, passcode, clientKeyFromHeaders(request.headers));
  switch (result.kind) {
    case "ok": {
      // The database has already counted this opening, so a failure from here on must still be a clean answer and not a bare 500.
      try {
        const { bundle } = buildSharedRecordBundle(result.record as unknown as SharedData);
        return NextResponse.json(buildManifest(JSON.stringify(bundle), key, parsed.data.embeddedLengthMax), { headers: HEADERS });
      } catch (error) {
        if (error instanceof ShlTooLarge) return NextResponse.json({ error: "too_large" }, { status: 413, headers: HEADERS });
        return NextResponse.json({ error: "unavailable" }, { status: 500, headers: HEADERS });
      }
    }
    case "pin_required":
      return NextResponse.json({ remainingAttempts: result.attemptsLeft }, { status: 401, headers: HEADERS });
    case "try_later":
      return NextResponse.json({ error: "try_later" }, { status: 429, headers: { ...HEADERS, "Retry-After": "300" } });
    default:
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  }
}
