"use client";

import { t, type Locale } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { splitIntoParts, type InstalmentPolicy } from "@/lib/commerce/instalments";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

export type PayMode = "full" | "parts";

const naira = (kobo: number) => `₦${formatNaira(kobo)}`;

/**
 * The choice between paying the yearly Membership at once or in parts (S25b). Shown only while the platform module is on and the order is a
 * plain full-price purchase for oneself. The numbers (how many parts, the days between them, the grace) are the database's, read from
 * instalment_policy_public; the split shown here is the same one the database makes, and the amount actually charged is always the database's.
 */
export function InstalmentChoice({ locale, policy, priceKobo, mode, onMode, id }: {
  locale: Locale; policy: InstalmentPolicy; priceKobo: number; mode: PayMode; onMode: (m: PayMode) => void; id: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t("shop.instalments.title", locale)}</legend>
      <label className={`${TOUCH} flex items-center gap-2`}>
        <input type="radio" name={`pay-mode-${id}`} checked={mode === "full"} onChange={() => onMode("full")} className="h-5 w-5" />
        <span>{t("shop.instalments.full", locale)} ({naira(priceKobo)})</span>
      </label>
      <label className={`${TOUCH} flex items-center gap-2`}>
        <input type="radio" name={`pay-mode-${id}`} checked={mode === "parts"} onChange={() => onMode("parts")} className="h-5 w-5" />
        <span>{t("shop.instalments.parts", locale, { parts: policy.parts })}</span>
      </label>
    </fieldset>
  );
}

/** What the plan would be, in plain words: each part, when it falls due, what happens if one is missed, and that nothing is taken on its own. */
export function InstalmentSummary({ locale, policy, priceKobo, id }: { locale: Locale; policy: InstalmentPolicy; priceKobo: number; id: string }) {
  const amounts = splitIntoParts(priceKobo, policy.parts);
  return (
    <section aria-labelledby={`parts-${id}`} className="space-y-2">
      <h3 id={`parts-${id}`} className="font-medium">{t("shop.instalments.parts", locale, { parts: policy.parts })}</h3>
      <ul className="space-y-1">
        {amounts.map((amount, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              {i === 0
                ? t("shop.instalments.first", locale, { amount: naira(amount) })
                : t("shop.instalments.then", locale, { n: i + 1, amount: naira(amount), days: policy.due_offsets_days[i] ?? 0 })}
            </span>
          </li>
        ))}
      </ul>
      <p>{t("shop.instalments.access", locale)}</p>
      <p className={`text-sm ${MUTED}`}>{t("shop.instalments.missed", locale, { days: policy.grace_days })}</p>
      <p className={`text-sm ${MUTED}`}>{t("shop.instalments.no_auto", locale)}</p>
      <p className={`text-sm ${MUTED}`}>{t("shop.instalments.refund_note", locale)}</p>
    </section>
  );
}
