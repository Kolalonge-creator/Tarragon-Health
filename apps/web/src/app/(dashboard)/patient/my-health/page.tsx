import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { fetchAccessLog } from "@/lib/my-health/access-log";
import { getAccessLogPageSize } from "@/lib/my-health/share-config";
import { t } from "@tarragon/i18n";
import { AccessLogList } from "./access-log-list";

const CARDS = [
  { href: "/patient/timeline", title: "my_health.card.timeline", body: "my_health.card.timeline_body" },
  { href: "/patient/emergency-card", title: "my_health.card.emergency", body: "my_health.card.emergency_body" },
  { href: "/patient/health-passport", title: "my_health.card.passport", body: "my_health.card.passport_body" },
  { href: "/patient/share-records", title: "my_health.card.shares", body: "my_health.card.shares_body" },
  { href: "/patient/my-health/lock-screen-card", title: "my_health.card.pass", body: "my_health.card.pass_body" },
] as const;

/**
 * One front door for the record the patient carries and shares (S09x-a): the timeline, the emergency card, the passport, the share links, the
 * lock-screen card, and the list of who has looked. The list is the patient's OWN account only (the database function is scoped to the signed-in
 * person), so while acting for someone else the page says so instead of showing the supporter's list under the dependant's name.
 */
export default async function MyHealthPage() {
  const { acting } = await getPatientDashboardContext();
  const supabase = await createClient();
  const log = acting ? null : await fetchAccessLog(supabase);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: "Dashboard" }}
        title={t("my_health.title")}
        icon={NAV_ICON.passport}
        description={t("my_health.description")}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
            <Card className="h-full transition-colors hover:bg-charcoal-ink/5">
              <CardHeader>
                <CardTitle>{t(c.title)}</CardTitle>
                <CardDescription>{t(c.body)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("my_health.log.title")}</CardTitle>
          <CardDescription>{t("my_health.log.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {acting ? (
            <p className="text-sm text-charcoal-ink/70">{t("my_health.log.acting")}</p>
          ) : log && log.ok ? (
            <AccessLogList initial={log.entries} pageSize={getAccessLogPageSize()} />
          ) : (
            <p role="alert" className="text-sm text-red-700">
              {t("my_health.log.failed")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
