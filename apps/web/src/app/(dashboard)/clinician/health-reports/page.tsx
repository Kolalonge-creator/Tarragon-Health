import { redirect } from "next/navigation";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { parseReportConfig } from "@/lib/health-report/build";
import { buildRenderModel, type ReportRow } from "@/lib/health-report/render-model";
import { HealthReportView } from "@/components/health-report-view";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Yearly health reports" };

/**
 * The clinician sign-off queue for yearly Health Reports (S46). Every read goes through audited, tie-checked database functions as the signed-in doctor
 * (INV-10, INV-12): a report for a patient who is not on this doctor's list never appears. An AI-drafted summary is shown only here, on the unsigned draft,
 * and is not part of the record until the doctor edits it and signs (INV-11).
 */
export default async function HealthReportsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const staff = await getCurrentClinicalStaff();
  if (!staff) redirect("/clinician");
  const { id } = await searchParams;
  const supabase = await createClient();

  if (!id) {
    const { data: queue } = await supabase.rpc("clinician_health_report_queue");
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">{t("report.review.title", "en")}</h1>
        {!queue || queue.length === 0 ? <p className="text-sm">{t("report.review.empty", "en")}</p> : null}
        <ul className="space-y-2">
          {(queue ?? []).map((r) => (
            <li key={r.id} className="rounded border p-3 text-sm">
              <Link className="font-medium underline" href={`/clinician/health-reports?id=${r.id}`}>
                {t("report.year", "en", { year: r.year })}, {t("report.version", "en", { version: r.version })}
              </Link>
              {r.is_correction ? <span> (correction)</span> : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { data: row } = await supabase.rpc("clinician_get_health_report", { p_id: id });
  if (!row) redirect("/clinician/health-reports");
  const { data: cfg } = await supabase.from("health_report_config_versions").select("config, approved_by").eq("id", row.config_version_id).maybeSingle();
  if (!cfg) redirect("/clinician/health-reports");
  const config = parseReportConfig(cfg.config);
  const composed = row.composed as unknown as ReportRow["composed"];
  const summary = row.summary_text ?? composed.templateSummary ?? "";
  const model = buildRenderModel(
    { year: row.year, version: row.version, composed, summary_text: summary, signer_name: row.signer_name ?? "(not signed yet)", signer_registration: row.signer_registration ?? "", signed_at: row.signed_at ?? new Date().toISOString(), correction_note: row.correction_note },
    config,
    "self",
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!config.statementApprovedByCmo ? <p role="note" className="rounded border p-2 text-sm">{t("report.review.statement_pending", "en")}</p> : null}
      {!cfg.approved_by ? <p role="note" className="rounded border p-2 text-sm">{t("report.review.settings_unsigned", "en")}</p> : null}
      <ReviewForm
        reportId={row.id}
        status={row.status as "pending_signature" | "signed" | "superseded"}
        templateSummary={composed.templateSummary ?? ""}
        aiDraft={row.ai_draft}
      />
      <HealthReportView model={model} />
    </div>
  );
}
