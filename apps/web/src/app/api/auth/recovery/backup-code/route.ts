import { NextResponse } from "next/server";
import { z } from "zod";
import { recoverWithBackupCode } from "@/lib/auth/recovery/recovery-routes";

/**
 * Backup-code recovery for the native app (S03b). The app has no session when it calls this, so it is public by design and
 * defended the same way the web form is: the shared limiter inside recoverWithBackupCode (per IP and per identifier), a
 * per-account lock in the database, and one answer for every kind of wrong. It sets the password server-side and returns only
 * how to sign in (the identifier the person typed, normalised); the app then signs in with the new password itself.
 */
const bodySchema = z.object({
  identifier: z.string().min(1).max(254),
  code: z.string().min(1).max(40),
  newPassword: z.string().min(1).max(256),
});

export async function POST(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });

  const result = await recoverWithBackupCode(parsed.data);
  if (result.ok) return NextResponse.json({ ok: true, signInWith: result.signInWith });
  switch (result.reason) {
    case "rate_limited":
      return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
    case "weak_password":
      return NextResponse.json({ ok: false, reason: "weak_password", message: result.message }, { status: 400 });
    case "unavailable":
      return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
    default:
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
}
