"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { LINK_BUTTON, TOUCH } from "./styles";
import { startEmergencyFromSafetyCard } from "./community-actions";

/**
 * Shown INSTEAD of a post when the words suggested an emergency or that the person may be thinking of harming themselves. The post was not
 * published. The tone is care, never rejection. Nothing here is sent anywhere by itself: the emergency button is the person's own tap, and it
 * goes to the app's existing emergency screen (which shows the hospital guidance and the contact alert).
 */
export function SafetyCard({ kind, locale, onDismiss }: { kind: "emergency" | "self_harm"; locale: Locale; onDismiss: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  // Moves focus to the card so a keyboard or screen-reader user meets it before anything else on the page.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const title = t(kind === "emergency" ? "community.safety.emergency.title" : "community.safety.self_harm.title", locale);
  const body = t(kind === "emergency" ? "community.safety.emergency.body" : "community.safety.self_harm.body", locale);

  async function alertContact() {
    setBusy(true);
    await startEmergencyFromSafetyCard();
    // Success or not, the existing emergency screen takes over: it confirms the alert, or explains what is missing (for example no saved contact).
    router.push("/patient");
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="community-safety-title"
      className="space-y-4 rounded-xl border-2 border-brand-green bg-soft-sage p-5 text-charcoal-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:bg-brand-green/20 dark:text-night-ink"
    >
      <h2 id="community-safety-title" className="font-heading text-xl font-semibold">
        {title}
      </h2>
      <p className="leading-relaxed">{body}</p>
      <div className="flex flex-wrap gap-3">
        {kind === "emergency" ? (
          <Button type="button" className={TOUCH} onClick={alertContact} disabled={busy}>
            {t("community.safety.emergency.contact", locale)}
          </Button>
        ) : (
          <Link href="/patient/messages" className={LINK_BUTTON}>
            {t("community.safety.self_harm.care_team", locale)}
          </Link>
        )}
        <Button type="button" variant="outline" className={TOUCH} onClick={onDismiss}>
          {t("community.safety.dismiss", locale)}
        </Button>
      </div>
    </section>
  );
}
