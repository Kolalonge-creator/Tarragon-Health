import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { askRecoveryContact, sendContactRecoveryLink } from "@/lib/auth/recovery/recovery-routes";

/**
 * Recovery-contact route for the native app (S03b). No session exists when it is called, so it is public by design; the
 * limiter inside the shared functions applies, and every answer for a well-formed identifier is the same {ok:true}, whether
 * or not an account, a contact, a confirmation or an elapsed wait exists. Nothing returned names an address or a number.
 */
const bodySchema = z.object({
  action: z.enum(["ask", "send"]),
  identifier: z.string().min(1).max(254),
});

export async function POST(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });

  let result;
  if (parsed.data.action === "ask") {
    result = await askRecoveryContact(parsed.data.identifier);
  } else {
    const site = process.env.NEXT_PUBLIC_SITE_URL;
    const svc = createServiceRoleClient();
    result = await sendContactRecoveryLink(parsed.data.identifier, {
      email: (address) => svc.auth.resetPasswordForEmail(address, { redirectTo: `${site}/reset-password` }),
      phoneCode: (phone) => svc.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } }),
    });
  }
  if (result.ok) return NextResponse.json({ ok: true });
  const status = result.reason === "rate_limited" ? 429 : result.reason === "invalid_input" ? 400 : 503;
  return NextResponse.json({ ok: false, reason: result.reason }, { status });
}
