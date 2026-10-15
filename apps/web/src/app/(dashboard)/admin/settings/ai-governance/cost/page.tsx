import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { loadAiCost } from "@/lib/ai-cost/load";
import { addAiModelPriceAction } from "@/lib/ai-cost/actions";
import { asNotice, defaultWindow, formatCost } from "@/lib/ai-cost/model";

export const metadata = { title: "AI cost" };
export const dynamic = "force-dynamic";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const iso = (v: string | undefined, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);

/**
 * S80 (25.10): what each AI feature costs, from logged token counts and the price valid when each call was made. Where no price
 * has been entered the cost reads "No price"; nothing is estimated. Prices are proposed and unsigned until a person signs them.
 */
export default async function AiCostPage({ searchParams }: { searchParams: Promise<{ n?: string; from?: string; to?: string }> }) {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!profile || (!isSuperAdmin && !keys.has("ai_governance.manage"))) redirect("/admin");
  const sp = await searchParams;
  const def = defaultWindow();
  const from = iso(sp.from, def.from);
  const to = iso(sp.to, def.to);
  const notice = asNotice(sp.n);
  const loaded = await loadAiCost(from, to);
  if (!loaded.ok && loaded.denied) redirect("/admin");
  const bad = notice !== null && notice !== "added";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("aicost.title", "en")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("aicost.intro", "en")}</p>
      </div>
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`aicost.notice.${notice}`, "en")}
        </p>
      )}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-charcoal-ink">{t("aicost.from", "en")}<input type="date" name="from" defaultValue={from} className={field} /></label>
        <label className="text-xs text-charcoal-ink">{t("aicost.to", "en")}<input type="date" name="to" defaultValue={to} className={field} /></label>
        <button type="submit" className="rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm font-semibold text-charcoal-ink">{t("aicost.show", "en")}</button>
      </form>
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("aicost.load_error", "en")}</p>
      ) : loaded.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("aicost.empty", "en")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-charcoal-ink/60">
              <tr><th className="py-1 pr-3">{t("aicost.feature", "en")}</th><th className="pr-3">{t("aicost.model", "en")}</th><th className="pr-3">{t("aicost.calls", "en")}</th><th className="pr-3">{t("aicost.tokens", "en")}</th><th>{t("aicost.cost", "en")}</th></tr>
            </thead>
            <tbody>
              {loaded.data.map((r) => (
                <tr key={`${r.system_code}:${r.model_identifier}:${r.currency ?? "none"}`} className="border-t border-charcoal-ink/10">
                  <td className="py-1 pr-3">{r.system_name} <span className="text-xs text-charcoal-ink/50">{r.system_code}</span></td>
                  <td className="pr-3">{r.model_identifier}</td>
                  <td className="pr-3">{r.interactions}</td>
                  <td className="pr-3">{r.input_tokens.toLocaleString("en-GB")} / {r.output_tokens.toLocaleString("en-GB")}</td>
                  <td>{formatCost(r.cost_millionths_minor, r.currency)}{r.currency !== null && r.priced_interactions < r.interactions ? ` (${r.priced_interactions} of ${r.interactions} priced)` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section aria-labelledby="add-price" className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
        <h2 id="add-price" className="font-heading text-lg font-semibold text-charcoal-ink">{t("aicost.add_title", "en")}</h2>
        <p className="text-xs text-charcoal-ink/70">{t("aicost.add_hint", "en")}</p>
        <form action={addAiModelPriceAction} className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-charcoal-ink">{t("aicost.model", "en")}<input name="model" required className={field} /></label>
          <label className="text-xs text-charcoal-ink">{t("aicost.input_price", "en")}<input name="input" type="number" min={0} step={1} required className={field} /></label>
          <label className="text-xs text-charcoal-ink">{t("aicost.output_price", "en")}<input name="output" type="number" min={0} step={1} required className={field} /></label>
          <label className="text-xs text-charcoal-ink">{t("aicost.currency", "en")}<input name="currency" required maxLength={3} placeholder="USD" className={field} /></label>
          <label className="text-xs text-charcoal-ink">{t("aicost.valid_from", "en")}<input name="valid_from" type="date" required className={field} /></label>
          <label className="text-xs text-charcoal-ink">{t("aicost.source", "en")}<input name="source_note" required minLength={10} maxLength={500} className={field} /></label>
          <div className="sm:col-span-3"><button type="submit" className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white">{t("aicost.save", "en")}</button></div>
        </form>
      </section>
    </div>
  );
}
