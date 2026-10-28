import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadLedger, loadMyChallenges } from "@/lib/research/load";
import { asNotice } from "@/lib/research/model";
import { raiseResearchChallengeAction } from "@/lib/research/actions";

export const metadata = { title: "How research uses data" };
export const dynamic = "force-dynamic";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/** The public list of research uses, with a way to ask a question or object. It names no person and gives no counts of people. */
export default async function PatientResearchPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const [ledger, mine] = await Promise.all([loadLedger(), loadMyChallenges()]);
  const bad = notice === "failed" || notice === "denied";
  return (
    <div className="space-y-6">
      <PageHeader backTo={{ href: "/patient/privacy", label: "Privacy" }} title={t("res.ledger.title", locale)} description={t("res.ledger.intro", locale)} />
      {notice && <FlashClean />}
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`res.notice.${notice}`, locale)}
        </p>
      )}
      {!ledger.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("res.ledger.load_error", locale)}</p>
      ) : ledger.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("res.ledger.empty", locale)}</p>
      ) : (
        <ul className="grid gap-3">
          {ledger.data.map((p) => (
            <li key={p.id} className="space-y-1 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <p className="font-medium text-charcoal-ink">{p.title}{p.status === "closed" && <span className="ml-2 text-xs font-normal text-charcoal-ink/60">{t("res.ledger.closed", locale)}</span>}</p>
              <p className="text-xs text-charcoal-ink/70">{t("res.ledger.for", locale)}: {p.question}</p>
              <p className="text-xs text-charcoal-ink/70">{t("res.ledger.to", locale)}: {p.recipient_name} ({t(`res.rt.${p.recipient_type}`, locale)})</p>
              {p.ethics_body && <p className="text-xs text-charcoal-ink/70">{t("res.ledger.ethics", locale)}: {p.ethics_body}{p.ethics_approved_on ? `, ${p.ethics_approved_on}` : ""}</p>}
              <p className="text-xs text-charcoal-ink/60">{t("res.ledger.releases", locale)}: {p.release_count}{p.last_release_on ? ` · ${t("res.ledger.last", locale)}: ${p.last_release_on}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="res-ask" className="space-y-3">
        <h2 id="res-ask" className="text-base font-semibold text-charcoal-ink">{t("res.ask.heading", locale)}</h2>
        <p className="max-w-3xl text-sm text-charcoal-ink/70">{t("res.ask.intro", locale)}</p>
        <form action={raiseResearchChallengeAction} className="grid max-w-xl gap-3">
          <label className="block text-xs text-charcoal-ink">{t("res.ask.about", locale)}
            <select name="protocol_id" defaultValue="" className={field}>
              <option value="">{t("res.ask.any", locale)}</option>
              {ledger.ok && ledger.data.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
            </select>
          </label>
          <label className="block text-xs text-charcoal-ink">{t("res.ask.message", locale)}<textarea name="message" required minLength={10} maxLength={2000} rows={4} className={field} /></label>
          <div><button type="submit" className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">{t("res.ask.submit", locale)}</button></div>
        </form>
      </section>
      <section aria-labelledby="res-mine" className="space-y-2">
        <h2 id="res-mine" className="text-base font-semibold text-charcoal-ink">{t("res.ask.mine", locale)}</h2>
        {!mine.ok ? (
          <p role="alert" className="text-sm text-amber-900">{t("res.q.load_error", locale)}</p>
        ) : mine.data.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("res.ask.none", locale)}</p>
        ) : (
          <ul className="grid gap-2">
            {mine.data.map((c) => (
              <li key={c.id} className="space-y-1 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                <p className="text-charcoal-ink">{c.message}</p>
                <p className="text-xs text-charcoal-ink/60">{c.status === "open" ? t("res.q.open", locale) : t("res.q.answered", locale)}</p>
                {c.answer && <p className="rounded-lg bg-charcoal-ink/5 p-2 text-sm text-charcoal-ink">{c.answer}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
