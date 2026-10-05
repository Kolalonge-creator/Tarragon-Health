"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { availableLocales, t, type Locale } from "@tarragon/i18n";
import { setAuthLocale } from "@/app/language-actions";
import { cn } from "@/lib/utils";

/**
 * English / Pidgin choice for the signed-out auth pages (S03). Stores the choice in a cookie via a server action and
 * refreshes so every server-rendered label re-reads it. Plain buttons, no icon-only control, reachable by keyboard.
 */
export function LanguageSwitch({ locale, pidginEnabled = true }: { locale: Locale; pidginEnabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Pidgin switched off platform-wide: one language left, so there is nothing to choose.
  if (!pidginEnabled) return null;

  return (
    <div role="group" aria-label={t("auth.language.title", locale)} className="flex justify-end gap-1 text-xs">
      {availableLocales(pidginEnabled).map((value) => (
        <button
          key={value}
          type="button"
          disabled={pending}
          aria-pressed={locale === value}
          onClick={() =>
            startTransition(async () => {
              await setAuthLocale(value);
              router.refresh();
            })
          }
          className={cn(
            "rounded-lg px-2.5 py-1 font-medium transition-colors",
            locale === value ? "bg-brand-green/10 text-brand-green" : "text-charcoal-ink/60 hover:text-charcoal-ink"
          )}
        >
          {t(value === "en" ? "auth.language.en" : "auth.language.pcm", locale)}
        </button>
      ))}
    </div>
  );
}
