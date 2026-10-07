import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auditSampleSchema, editRatesSchema } from "@/lib/scribe/review-record";
import { DRAFT_SECTION_KEYS } from "@/lib/scribe/draft-review";

export const metadata = { title: "Scribe quality" };
export const dynamic = "force-dynamic";

const day = (v: string): string => new Date(v).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

/**
 * The Chief Medical Officer's view of how the AI scribe's drafts are used: per-section outcome counts and a random sample of
 * signed AI-drafted notes to check against what happened. Same gate as the team caseload page (a CMO's clinician login never
 * reaches /admin); the database functions refuse anyone else too. Counts and ids only: no draft text exists to show.
 */
export default async function ScribeQualityPage() {
  if (!canAssignCases(await getCurrentClinicalStaff())) redirect("/clinician");
  const supabase = loose(await createClient());
  const [ratesRes, sampleRes] = await Promise.all([supabase.rpc("scribe_edit_rates"), supabase.rpc("scribe_audit_sample", { p_n: 10 })]);
  const rates = ratesRes.error ? null : editRatesSchema.safeParse(ratesRes.data);
  const sample = sampleRes.error ? null : auditSampleSchema.safeParse(sampleRes.data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("scribequality.title", "en")}</h1>
        <p className="text-sm text-charcoal-ink/60">{t("scribequality.subtitle", "en")}</p>
      </div>

      <Card>
        <CardHeader><CardTitle>{rates?.success ? t("scribequality.reviews", "en", { count: rates.data.reviews }) : t("scribequality.title", "en")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!rates?.success && <p role="alert" className="text-sm text-red-600">{t("scribequality.load_error", "en")}</p>}
          {rates?.success && rates.data.reviews === 0 && <p className="text-sm text-charcoal-ink/60">{t("scribequality.none", "en")}</p>}
          {rates?.success && rates.data.reviews > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/60">
                    <th className="py-1 pr-3">{t("scribequality.section", "en")}</th>
                    <th className="px-2">{t("scribequality.unchanged", "en")}</th>
                    <th className="px-2">{t("scribequality.edited", "en")}</th>
                    <th className="px-2">{t("scribequality.emptied", "en")}</th>
                    <th className="px-2">{t("scribequality.added", "en")}</th>
                    <th className="px-2">{t("scribequality.empty_kept", "en")}</th>
                  </tr>
                </thead>
                <tbody>
                  {DRAFT_SECTION_KEYS.map((k) => {
                    const c = rates.data.sections[k];
                    return (
                      <tr key={k} className="border-b border-charcoal-ink/5">
                        <td className="py-1 pr-3 font-medium">{k}</td>
                        <td className="px-2">{c?.unchanged ?? 0}</td>
                        <td className="px-2">{c?.edited ?? 0}</td>
                        <td className="px-2">{c?.emptied ?? 0}</td>
                        <td className="px-2">{c?.added ?? 0}</td>
                        <td className="px-2">{c?.empty_kept ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-charcoal-ink/60">{t("scribequality.reading", "en")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("scribequality.sample_title", "en")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-charcoal-ink/60">{t("scribequality.sample_help", "en")}</p>
          {!sample?.success && <p role="alert" className="text-sm text-red-600">{t("scribequality.load_error", "en")}</p>}
          {sample?.success && sample.data.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("scribequality.sample_none", "en")}</p>}
          {sample?.success && sample.data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {sample.data.map((n) => (
                <li key={n.note_id} className="flex flex-wrap gap-3 py-1">
                  <code className="text-xs">{n.note_id}</code>
                  <span>{n.finalized_at ? day(n.finalized_at) : "-"}</span>
                  <span className="text-xs text-charcoal-ink/60">{n.has_hash ? t("scribequality.hash", "en") : t("scribequality.no_hash", "en")}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("scribequality.wer_title", "en")}</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-charcoal-ink">{t("scribequality.wer_body", "en")}</p></CardContent>
      </Card>
    </div>
  );
}
