import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { CareVisibilityList } from "../family/care-visibility-list";
import { ConsentStatusPanel } from "./consent-status-panel";
import { ConnectedDevicesSummary } from "./connected-devices-summary";
import { DataRightsPanel } from "./data-rights-panel";
import { PrivacySummary } from "./privacy-summary";
import { getAuthLocale } from "@/lib/auth/auth-locale";
import * as Sentry from "@sentry/nextjs";
import { parseConsentMatrix, CONSENT_DATA_TYPES, CONSENT_PURPOSES } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { ConsentMatrixPanel, type ConsentHistoryItem } from "./consent-matrix-panel";
import { ProxyArrangementsCard, type ProxyArrangement } from "../family/proxy-arrangements-card";

/**
 * Privacy & data centre, docs spec §87.7. Composes what already exists
 * elsewhere (consent status, CareVisibilityList — reused, not rebuilt) with
 * what this gap-closure pass added: a self-service DSAR export
 * (§87.8) and the two request workflows (§87.9 correction, §87.11
 * deletion). There is deliberately no "which org staff can see me" section
 * here — no such feature exists anywhere on the platform to surface (org
 * staff access is governed by RLS, not by a patient-visible access log),
 * and this page should not fabricate one.
 */
export default async function PrivacyCentrePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");
  if (!profile.organisation_id) redirect("/login");
  const locale = await getAuthLocale();

  // The consent matrix and its history come from the patient's own session (RLS and the RPCs scope them). A failed read is
  // reported and shown as an error, never as "everything is off", because a wrong picture of consent is worse than none.
  const supabase = await createClient();
  const [matrixResult, historyResult, arrangementResult] = await Promise.all([
    supabase.rpc("my_consent_matrix"),
    supabase.rpc("my_consent_matrix_history", { p_limit: 50 }),
    supabase.rpc("my_proxy_arrangements"),
  ]);
  for (const [name, result] of [["my_consent_matrix", matrixResult], ["my_consent_matrix_history", historyResult], ["my_proxy_arrangements", arrangementResult]] as const) {
    if (result.error) Sentry.captureMessage(`${name} failed`, { level: "warning", tags: { pg_code: result.error.code ?? "none" } });
  }
  const matrix = matrixResult.error ? null : parseConsentMatrix(matrixResult.data);
  const history = (Array.isArray(historyResult.data) ? historyResult.data : []) as unknown as Array<{ data_type: string; purpose: string; action: string; at: string }>;
  const historyItems: ConsentHistoryItem[] = history
    .filter((h) => (CONSENT_DATA_TYPES as readonly string[]).includes(h.data_type) && (CONSENT_PURPOSES as readonly string[]).includes(h.purpose))
    .map((h) => ({ data_type: h.data_type as ConsentHistoryItem["data_type"], purpose: h.purpose as ConsentHistoryItem["purpose"], action: h.action === "granted" ? "granted" : "withdrawn", at: h.at }));
  const arrangements = (Array.isArray(arrangementResult.data) ? arrangementResult.data : []) as unknown as ProxyArrangement[];

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: "Dashboard" }}
        title="Privacy & your data"
        icon={SEMANTIC_ICON.privacy}
        description="What you've agreed to, who can see your record, and how to request, correct, or delete your data."
      />

      <PrivacySummary locale={locale} />

      {matrix ? (
        <ConsentMatrixPanel matrix={matrix} history={historyItems} />
      ) : (
        <p role="alert" className="text-sm text-red-700">
          {t("consent.matrix.load_error")}
        </p>
      )}

      <ProxyArrangementsCard arrangements={arrangements} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ConsentStatusPanel patientId={profile.id} />
        <ConnectedDevicesSummary patientId={profile.id} />
      </div>

      <CareVisibilityList />

      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">Your data rights</h2>
        <p className="mb-3 text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Under Nigeria&apos;s Data Protection Act, you can ask to see, correct, or delete the data we
          hold about you.
        </p>
        <DataRightsPanel organisationId={profile.organisation_id} patientId={profile.id} />
      </div>
    </div>
  );
}
