import { t } from "@tarragon/i18n";
import { Check, X } from "lucide-react";

type Lang = Parameters<typeof t>[1];

export type LifestyleItem = { kind: "do" | "limit"; title: string; detail: string };

/**
 * General day-to-day guidance shown beside a person's results: what usually helps, and what to go easy on. It is the same for
 * everyone and says so. Personalised advice is the care team's job and is never generated here.
 */
export function LifestyleGuide({ items, uiLanguage }: { items: readonly LifestyleItem[]; uiLanguage: Lang }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="lifestyle-guide-title" className="space-y-3">
      <div>
        <h2 id="lifestyle-guide-title" className="text-lg font-semibold text-charcoal-ink dark:text-night-ink">
          {t("biomarkers.guide.title", uiLanguage)}
        </h2>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("biomarkers.guide.note", uiLanguage)}</p>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-3 rounded-2xl border border-charcoal-ink/10 bg-white p-3 dark:border-night-ink/15 dark:bg-night-card">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${item.kind === "do" ? "bg-deep-forest" : "bg-rose-800"}`}
            >
              {item.kind === "do" ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
              <span className="sr-only">{t(item.kind === "do" ? "biomarkers.guide.do" : "biomarkers.guide.limit", uiLanguage)}</span>
            </span>
            <div>
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{item.title}</p>
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
