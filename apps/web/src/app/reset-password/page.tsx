import { getCurrentUser } from "@/lib/supabase/server";
import { ResetPasswordGate } from "./reset-password-gate";

/**
 * Reachable with an active session — either the OTP-verify step in
 * /forgot-password (phone path, session already cookie-backed server-side)
 * or Supabase's hosted recovery-link redirect (email path, session only
 * lands in a URL fragment the server can't see). ResetPasswordGate handles
 * the fragment case client-side and bounces to /forgot-password only once
 * neither a server session nor a fragment session is found.
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-semibold text-brand-green">
            Set a new password
          </h1>
          <p className="mt-1 text-sm text-charcoal-ink/60">
            Choose a new password for your account.
          </p>
        </div>
        <ResetPasswordGate hasServerSession={!!user} />
      </div>
    </div>
  );
}
