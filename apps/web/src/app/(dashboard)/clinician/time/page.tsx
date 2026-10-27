import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseMemberMonthMinutes, sourceLabel, tierLabel } from "@/lib/clinician/time-report";

export const metadata = { title: "Care team time" };
export const dynamic = "force-dynamic";

/**
 * W-01, CMO only: minutes of doctor time per Member per month, by kind of work and membership. Reads one aggregate (member_month_minutes).
 * It carries no clinician name and no per-clinician figure, and nothing here is ordered by a person.
 */
export default async function CareTeamTimePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");

  const supabase = loose(await createClient());
  const { data, error } = await supabase.rpc("member_month_minutes", { p_month: null });
  const rows = error ? null : parseMemberMonthMinutes(data);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("time.page_title", "en")}</h1>
        <p className="text-sm text-charcoal-ink/70">{t("time.page_intro", "en")}</p>
      </div>
      <Card>
        <CardHeader><CardTitle>{new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Lagos" })}</CardTitle></CardHeader>
        <CardContent>
          {rows === null ? (
            <p role="alert" className="text-sm text-red-600">{t("time.load_error", "en")}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">{t("time.page_empty", "en")}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-charcoal-ink/60">
                  <th className="py-1 pr-3">{t("time.col_source", "en")}</th>
                  <th className="py-1 pr-3">{t("time.col_tier", "en")}</th>
                  <th className="py-1 pr-3">{t("time.col_members", "en")}</th>
                  <th className="py-1 pr-3">{t("time.col_median", "en")}</th>
                  <th className="py-1 pr-3">{t("time.col_p90", "en")}</th>
                  <th className="py-1">{t("time.col_total", "en")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.source}-${r.tier}`} className="border-t border-charcoal-ink/10">
                    <td className="py-1 pr-3">{sourceLabel(r.source)}</td>
                    <td className="py-1 pr-3">{tierLabel(r.tier)}</td>
                    <td className="py-1 pr-3">{r.members}</td>
                    <td className="py-1 pr-3">{r.median_minutes ?? t("time.small_group", "en")}</td>
                    <td className="py-1 pr-3">{r.p90_minutes ?? t("time.small_group", "en")}</td>
                    <td className="py-1">{r.total_minutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
