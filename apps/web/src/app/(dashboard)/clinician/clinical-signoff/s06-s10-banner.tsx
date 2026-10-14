import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { countPendingRows, S06_S10_FOUNDER_REVIEW, type S06S10Status } from "@/lib/clinical/s06-s10-signoff-model";
import type { S06S10Snapshot } from "@/lib/queries/s06-s10-signoffs";
import { signoffAnchorId } from "@/lib/signoff-anchor";

const locale = DEFAULT_UI_LANGUAGE;

const STATUS_BADGE: Record<S06S10Status, { variant: BadgeProps["variant"]; label: Parameters<typeof t>[0] }> = {
  pending: { variant: "amber", label: "s06s10.status.pending" },
  signed: { variant: "green", label: "s06s10.status.signed" },
  missing: { variant: "red", label: "s06s10.status.missing" },
  unreadable: { variant: "red", label: "s06s10.status.unreadable" },
};

/**
 * One grouped section at the top of the Chief Medical Officer's sign-off hub: the eight S06 to S10 clinical decisions (C1 to C8), each with what
 * it is, what was decided on 7 October 2026, how far its guideline basis was read, whether it is signed, and a direct link to the line that
 * signs it. It only reads: every Sign control stays in the hub line it links to, behind its own confirmation.
 *
 * A row that could not be read says so; an all-signed state is only claimed when all eight were actually read and signed.
 */
export function S06S10Banner({ snapshot }: { snapshot: S06S10Snapshot }) {
  const { rows } = snapshot;
  if (rows.length === 0) {
    return (
      <section aria-labelledby="s06s10-h" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 id="s06s10-h" className="font-heading text-base font-semibold">{t("s06s10.title", locale)}</h2>
        <p role="alert" className="mt-1">{t("golive.load_error", locale)}</p>
      </section>
    );
  }
  const open = countPendingRows(rows);
  const allSigned = rows.every((r) => r.status === "signed");
  const registryOpen = snapshot.openProposed.length;
  return (
    <section id="s06-s10" aria-labelledby="s06s10-h" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="s06s10-h" className="font-heading text-lg font-semibold text-charcoal-ink">{t("s06s10.title", locale)}</h2>
        <p className="text-sm font-medium text-charcoal-ink">
          {allSigned && registryOpen === 0
            ? t("s06s10.all_done", locale)
            : allSigned
              ? t("s06s10.rows_done_registry_open", locale, { count: registryOpen })
              : t("s06s10.count", locale, { open, total: rows.length })}
        </p>
      </div>
      <p className="max-w-3xl text-sm text-charcoal-ink/70">{t("s06s10.intro", locale)}</p>
      {snapshot.failed && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          Could not read: {snapshot.failedSources.join(", ")}. A row marked as could not be read is not signed and is not an all-clear.
        </p>
      )}
      <ul className="grid gap-3">
        {rows.map((r) => {
          const badge = STATUS_BADGE[r.status];
          const href = r.panelKey ? `#${signoffAnchorId(r.panelKey)}` : r.fallbackHref;
          return (
            <li key={r.id} id={`s06s10-${r.id.toLowerCase()}`} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-charcoal-ink">
                  <span className="mr-2 rounded bg-charcoal-ink/10 px-1.5 py-0.5 font-mono text-xs">{r.id}</span>
                  {r.title}
                </p>
                <span className="flex items-center gap-3">
                  <Badge variant={badge.variant}>{t(badge.label, locale)}</Badge>
                  <a href={href} className="text-xs font-semibold text-brand-green underline">
                    {r.status === "pending" && r.panelKey ? t("s06s10.open", locale) : t("s06s10.open_signed", locale)}
                  </a>
                </span>
              </div>
              <p className="mt-1 text-xs text-charcoal-ink/60">{r.note}</p>
              <dl className="mt-2 grid gap-1 text-xs text-charcoal-ink sm:grid-cols-[9rem_1fr]">
                <dt className="font-medium text-charcoal-ink/70">{t("s06s10.col.decision", locale)}</dt>
                <dd>{r.decision}</dd>
                <dt className="font-medium text-charcoal-ink/70">{t("s06s10.col.basis", locale)}</dt>
                <dd>{r.basis}</dd>
                <dt className="font-medium text-charcoal-ink/70">{t("s06s10.col.how", locale)}</dt>
                <dd>{r.how}</dd>
              </dl>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-lg border border-charcoal-ink/10 bg-white/70 p-3 dark:border-night-ink/15 dark:bg-night-card/60">
        <h3 className="font-heading text-sm font-semibold text-charcoal-ink">{t("s06s10.review.title", locale)}</h3>
        <p className="text-xs text-charcoal-ink/70">{t("s06s10.review.intro", locale)}</p>
        <ul className="space-y-1 text-xs text-charcoal-ink">
          {S06_S10_FOUNDER_REVIEW.map((f) => {
            const found = snapshot.founderReview.find((x) => x.key === f.key);
            const done = found?.row ? found.row.status === "signed" || found.row.status === "confirmed_in_registry" : false;
            return (
              <li key={f.key} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-mono">{f.key}</span>: {f.what}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={done ? "green" : "grey"}>{done ? t("s06s10.review.done", locale) : t("s06s10.review.waiting", locale)}</Badge>
                  <a href={`/clinician/go-live#${f.key}`} className="font-semibold text-brand-green underline">
                    {t("s06s10.review.open", locale)}
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-charcoal-ink/60">{t("s06s10.partner_map", locale)}</p>
      </div>
    </section>
  );
}
