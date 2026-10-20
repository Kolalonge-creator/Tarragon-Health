import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { fetchMyPhones } from "@/lib/my-phones/phones";
import { t } from "@tarragon/i18n";
import { PhonesList } from "./phones-list";

/**
 * "My phones" (S06x follow-up): the phones that keep a saved, encrypted copy of this person's entries, and a way to say one was lost.
 * The list is the signed-in person's OWN account only (the table's row policy returns nothing else), so while acting for someone else
 * the page says so instead of showing the supporter's phones under the dependant's name.
 */
export default async function MyPhonesPage() {
  const { acting } = await getPatientDashboardContext();
  const supabase = await createClient();
  const result = acting ? null : await fetchMyPhones(supabase);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/my-health", label: t("my_health.title") }}
        title={t("phones.title")}
        icon={NAV_ICON.passport}
        description={t("phones.description")}
      />
      <Card>
        <CardContent className="pt-6">
          {acting ? (
            <p className="text-sm text-charcoal-ink/70">{t("phones.acting")}</p>
          ) : result && result.ok ? (
            <PhonesList initial={result.phones} />
          ) : (
            <p role="alert" className="text-sm text-red-700">
              {t("phones.load_failed")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
