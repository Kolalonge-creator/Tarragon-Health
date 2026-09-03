"use client";

import * as React from "react";
import Link from "next/link";
import type { UserRole } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";
import { APP_ICON } from "@/lib/icons";
import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "th_mfa_nudge_dismissed";

/**
 * Roles this security-hardening pass treats as higher-risk (broad
 * platform/PHI access via /clinician, /admin, /pharmacist, or a partner
 * console). This is only a display filter for the nudge below, never an
 * enforcement list — self-service TOTP MFA stays fully opt-in for every
 * role, per the founder's explicit decision not to make MFA mandatory while
 * real clinical-staff enrollment is still low (a hard requirement risks
 * locking out active doctors mid-rollout).
 */
const MFA_NUDGE_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "clinician",
  "admin",
  "pharmacist",
  "lab_partner",
  "lab_liaison",
]);

/**
 * Soft, dismissible reminder to turn on two-factor sign-in — read-only, never
 * a gate. Shown only when the signed-in role is one of MFA_NUDGE_ROLES above
 * AND the account has no verified TOTP factor yet (checked client-side via
 * the same `auth.mfa.listFactors()` call `mfa-settings-card.tsx` uses).
 * Dismissal is sessionStorage-only, deliberately not persisted server-side or
 * in localStorage — it reappears on the next fresh login/browser session,
 * since the underlying risk (no MFA on a high-access account) hasn't
 * changed. Dismissing never affects navigation or any other part of the
 * dashboard.
 */
export function MfaNudgeBanner({ role }: { role: UserRole | null | undefined }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!role || !MFA_NUDGE_ROLES.has(role)) return;

    let cancelled = false;

    // setVisible is called from inside this async callback, not synchronously
    // in the effect body — same pattern as PushSubscribePrompt.
    void (async () => {
      let dismissed = false;
      try {
        dismissed = window.sessionStorage.getItem(DISMISSED_KEY) === "1";
      } catch {
        // sessionStorage unavailable — fall through and show the nudge anyway.
      }
      if (dismissed) return;

      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error || cancelled) return;

      const hasVerifiedFactor = (data?.totp ?? []).some((f) => f.status === "verified");
      if (!hasVerifiedFactor) setVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [role]);

  const dismiss = () => {
    setVisible(false);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // fine to skip persisting the dismissal — worst case it re-shows once.
    }
  };

  if (!visible) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-xl border border-brand-green/20 bg-brand-green/5 p-4"
    >
      <APP_ICON.security className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" strokeWidth={2} />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium text-charcoal-ink">
          Add an extra layer of protection to your account
        </p>
        <p className="text-charcoal-ink/70">
          Turn on two-factor sign-in whenever you&apos;re ready. It takes about a minute with an
          authenticator app.{" "}
          <Link
            href="/account"
            className="font-medium text-deep-forest underline underline-offset-2"
          >
            Set it up in Profile &amp; settings
          </Link>
          .
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 p-0 text-charcoal-ink/40 hover:text-charcoal-ink"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <APP_ICON.close className="h-4 w-4" strokeWidth={2} />
      </Button>
    </div>
  );
}
