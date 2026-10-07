import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { loadAiCost } from "@/lib/ai-review/load";
import { nairaFromKobo } from "@/lib/ai-review/model";

export const metadata = { title: "AI cost" };
export const dynamic = "force-dynamic";

/** S80c: AI cost per assistant per month in naira from integer kobo. Unpriced calls are counted apart and never shown as free. */
export default async function AiCostPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const locale = DEFAULT_UI_LANGUAGE;
  const loaded = await loadAiCost();
  if (!loaded.ok && loaded.denied) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("aicost.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("aicost.intro", locale)}</p>
      </div>
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("aicost.load_error", locale)}</p>
      ) : loaded.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("aicost.empty", locale)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-charcoal-ink/15 text-xs text-charcoal-ink/70">
                <th scope="col" className="py-2 pr-3">AI</th>
                <th scope="col" className="py-2 pr-3">Month</th>
                <th scope="col" className="py-2 pr-3">{t("aicost.calls", locale)}</th>
                <th scope="col" className="py-2 pr-3">{t("aicost.tokens", locale)}</th>
                <th scope="col" className="py-2 pr-3">{t("aicost.cost", locale)}</th>
                <th scope="col" className="py-2">{t("aicost.unpriced", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {loaded.data.map((r) => (
                <tr key={`${r.system_code}:${r.month}`} className="border-b border-charcoal-ink/10">
                  <td className="py-2 pr-3 font-medium text-charcoal-ink">{r.system_code}</td>
                  <td className="py-2 pr-3">{r.month.slice(0, 7)}</td>
                  <td className="py-2 pr-3">{r.calls}</td>
                  <td className="py-2 pr-3">{r.input_tokens.toLocaleString("en-NG")} / {r.output_tokens.toLocaleString("en-NG")}</td>
                  <td className="py-2 pr-3">{r.cost_kobo === null ? t("aicost.price_missing", locale) : nairaFromKobo(r.cost_kobo)}</td>
                  <td className="py-2">{r.unpriced_calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
