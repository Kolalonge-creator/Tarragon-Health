import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { loadMyConcerns } from "@/lib/concerns/load";
import { asConcernNotice, deadlines, labelKey } from "@/lib/concerns/model";
import { addToMyConcernAction } from "@/lib/concerns/actions";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "My concerns", robots: { index: false, follow: false } };
// Never cached and never static (INV-07): the page shows the person's own private words.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/**
 * S36i: "My concerns" for any clinician. Shows only the concerns this person raised (the function filters by the signed-in user)
 * and the replies meant for them. No concern id is in the address; adding to one posts the id in the body.
 */
export default async function MyConcernsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  if ((await getCurrentClinicalStaff()) === null) redirect("/clinician");
  const profile = await getCurrentProfile();
  const locale = resolveUiLanguage(profile?.language, await getPidginEnabled());
  const notice = asConcernNotice((await searchParams).n);
  const mine = await loadMyConcerns();
  const now = new Date().getTime();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("speakup.mine.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.mine.intro", locale)}</p>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.mine.raise_hint", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={notice === "failed" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${notice === "failed" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`speakup.notice.${notice}`, locale)}
        </p>
      )}
      {!mine.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("speakup.load_error", locale)}</p>
      ) : mine.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("speakup.mine.none", locale)}</p>
      ) : (
        <ul className="grid gap-3">
          {mine.data.map((c) => {
            const d = deadlines(c, now);
            return (
              <li key={c.id} className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
                <p className="font-medium text-charcoal-ink">
                  {t(labelKey("concern.category", c.category), locale)} · {t(labelKey("concern.severity", c.severity), locale)}
                  <span className="ml-2 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs font-semibold">{t(`speakup.state.${c.state}`, locale)}</span>
                </p>
                <p className="text-xs text-charcoal-ink/60">
                  {t("speakup.raised_on", locale)} {lagos(c.created_at)}
                  {d.acknowledge === "overdue" ? ` · ${t("speakup.deadline.overdue", locale)}` : ""}
                </p>
                <p className="whitespace-pre-wrap rounded-lg bg-charcoal-ink/5 p-3 text-charcoal-ink">{c.description}</p>
                {c.messages.filter((m) => m.body).length > 0 && (
                  <ul className="space-y-1">
                    {c.messages.filter((m) => m.body).map((m, i) => (
                      <li key={i} className="text-charcoal-ink/80">
                        <span className="font-medium">{m.mine ? t("speakup.mine.you", locale) : t("speakup.mine.lead", locale)}</span> · {lagos(m.created_at)}
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {c.state === "closed" ? (
                  <p className="text-xs text-charcoal-ink/60">{t("speakup.mine.closed_note", locale)}</p>
                ) : (
                  <form action={addToMyConcernAction} className="space-y-2">
                    <input type="hidden" name="concern" value={c.id} />
                    <label className="block text-xs text-charcoal-ink">
                      {t("speakup.mine.add", locale)}
                      <textarea name="body" required minLength={5} maxLength={4000} rows={2} className={field} />
                    </label>
                    <p className="text-xs text-charcoal-ink/60">{t("speakup.mine.add_hint", locale)}</p>
                    <button type="submit" className="rounded-lg border border-charcoal-ink/20 px-3 py-1.5 text-sm font-semibold text-charcoal-ink">{t("speakup.mine.add_submit", locale)}</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
