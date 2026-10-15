import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { ConfigCard } from "@/components/go-live/go-live-page";
import type { ConfigRow } from "@/lib/go-live/model";

const locale = DEFAULT_UI_LANGUAGE;

/**
 * The registry values the Chief Medical Officer owns from the S06 to S10 build, each with its own confirm control (the go-live page's card,
 * returning to the hub). The rows come from the hub's single read, so this list and the hub line's count cannot disagree.
 */
export function ProposedValuesPanel({ rows }: { rows: readonly ConfigRow[] }) {
  return (
    <div className="space-y-3">
      <h3 className="font-heading text-base font-semibold text-charcoal-ink">{t("s06s10.proposed.title", locale)}</h3>
      <p className="text-sm text-charcoal-ink/70">{t("s06s10.proposed.intro", locale)}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("s06s10.proposed.none", locale)}</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <ConfigCard key={`${r.key}@${r.version}`} r={r} viewer="cmo" locale={locale} back="hub" />
          ))}
        </ul>
      )}
    </div>
  );
}
