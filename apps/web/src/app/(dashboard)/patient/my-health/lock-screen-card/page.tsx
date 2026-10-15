import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { buildLockScreenPayload, type LockScreenFacts } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { PassToggle } from "./pass-toggle";

/**
 * The lock-screen card (S09x-c). Off until the patient turns it on (D4). This page is the patient's own setting and the printable card; the
 * device and wallet versions need Apple and Google credentials that do not exist yet and stay behind the `wallet_pass` go-live guard (off).
 * The printed card is the patient's own choice to print, so it does not wait for the CMO's signature on the field list; the device and wallet
 * versions do (buildLockScreenPayload's requireSigned).
 */
export default async function LockScreenCardPage() {
  const { acting } = await getPatientDashboardContext();
  const supabase = await createClient();
  const { data, error } = acting ? { data: null, error: null } : await supabase.rpc("my_lock_screen_facts");
  const facts = (data ?? null) as LockScreenFacts | null;
  const payload = buildLockScreenPayload(facts, { requireSigned: false });

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/my-health", label: t("my_health.title") }}
        title={t("my_health.pass.title")}
        icon={NAV_ICON.passport}
        description={t("my_health.pass.description")}
      />

      {acting ? (
        <p className="text-sm text-charcoal-ink/70">{t("my_health.log.acting")}</p>
      ) : error || !facts ? (
        <p role="alert" className="text-sm text-red-700">
          {t("my_health.pass.failed")}
        </p>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <PassToggle enabled={facts.enabled === true} signed={facts.fields_signed === true} />
            </CardContent>
          </Card>

          {facts.enabled === true && (
            <Card className="max-w-sm print:border-2 print:shadow-none">
              <CardHeader>
                <CardTitle>{t("my_health.pass.preview")}</CardTitle>
                <CardDescription>TarragonHealth</CardDescription>
              </CardHeader>
              <CardContent>
                {payload ? (
                  <dl className="space-y-2 text-sm">
                    {payload.rows.map((r) => (
                      <div key={r.key} className="flex justify-between gap-4">
                        <dt className="text-charcoal-ink/70">{r.label}</dt>
                        <dd className="font-medium text-charcoal-ink">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-charcoal-ink/70">{t("my_health.pass.nothing")}</p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
