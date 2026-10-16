import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadTranslations } from "@/lib/translations/load";
import { asNotice, nextSteps, type TranslationState } from "@/lib/translations/model";
import { reviewTranslationAction } from "@/lib/translations/actions";

export const metadata = { title: "Translations" };
export const dynamic = "force-dynamic";

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const LABEL: Record<TranslationState, "xlat.to_draft" | "xlat.to_native" | "xlat.to_clinical"> = {
  draft: "xlat.to_draft",
  native_reviewed: "xlat.to_native",
  clinical_reviewed: "xlat.to_clinical",
};

/** S80a: translation review states (spec 25.1). No language is switched on here; this is the review record and the next legal step. */
export default async function TranslationsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const loaded = await loadTranslations();
  if (!loaded.ok && loaded.denied) redirect("/admin");
  const bad = notice === "failed" || notice === "denied";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("xlat.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("xlat.intro", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`xlat.notice.${notice}`, locale)}
        </p>
      )}
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("xlat.load_error", locale)}</p>
      ) : loaded.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("xlat.empty", locale)}</p>
      ) : (
        <ul className="grid gap-2">
          {loaded.data.map((r) => (
            <li key={r.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <p className="font-medium text-charcoal-ink">
                {r.key} <span className="ml-1 text-xs font-normal text-charcoal-ink/60">{r.language}{r.is_clinical ? ` · ${t("xlat.clinical", locale)}` : ""}</span>
              </p>
              <p className="text-xs text-charcoal-ink/70">{t(`xlat.state.${r.state}`, locale)}</p>
              <div className="flex flex-wrap gap-2">
                {nextSteps(r.state).map((s) => (
                  <form key={s} action={reviewTranslationAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="state" value={s} />
                    <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t(LABEL[s], locale)}</button>
                  </form>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
