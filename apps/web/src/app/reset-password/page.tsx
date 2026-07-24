import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Reachable only with an active session — either from the recovery-link
 * exchange in /auth/callback (email path) or the OTP-verify step in
 * /forgot-password (phone path). No session means the link/code is stale.
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/forgot-password");
  }

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
        <ResetPasswordForm />
      </div>
    </div>
  );
}
