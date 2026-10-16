import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadReviewQueue } from "@/lib/ai-review/load";
import { asNotice, VERDICTS } from "@/lib/ai-review/model";
import { reviewAiSampleAction } from "@/lib/ai-review/actions";

export const metadata = { title: "AI answer review" };
export const dynamic = "force-dynamic";

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/** S80c: clinician review of a sample of AI answers (spec 25.10, D.5). Shows the answer only, never the person; every open is audited. */
export default async function AiReviewPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const loaded = await loadReviewQueue();
  if (!loaded.ok && loaded.denied) redirect("/clinician");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("airev.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("airev.intro", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={notice === "failed" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${notice === "failed" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`airev.notice.${notice}`, locale)}
        </p>
      )}
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("airev.load_error", locale)}</p>
      ) : loaded.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("airev.empty", locale)}</p>
      ) : (
        <ul className="grid gap-3">
          {loaded.data.map((r) => (
            <li key={r.sample_id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <p className="text-xs text-charcoal-ink/60">{r.system_code} · {r.sampled_by_rule === "flagged" ? t("airev.flagged", locale) : t("airev.sampled", locale)}</p>
              <p className="whitespace-pre-wrap text-charcoal-ink">{r.output_summary ?? ""}</p>
              <form action={reviewAiSampleAction} className="space-y-2">
                <input type="hidden" name="id" value={r.sample_id} />
                <label className="block text-xs text-charcoal-ink">
                  {t("airev.verdict", locale)}
                  <select name="verdict" required defaultValue="" className={field}>
                    <option value="" disabled></option>
                    {VERDICTS.map((v) => (<option key={v} value={v}>{t(`airev.verdict.${v}`, locale)}</option>))}
                  </select>
                </label>
                <label className="block text-xs text-charcoal-ink">
                  {t("airev.note", locale)}
                  <textarea name="note" maxLength={1000} rows={2} className={field} />
                </label>
                <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("airev.submit", locale)}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
