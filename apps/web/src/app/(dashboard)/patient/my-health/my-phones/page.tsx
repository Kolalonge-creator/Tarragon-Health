import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { fetchMyPhones } from "@/lib/my-health/my-phones";
import { buildPhoneViews } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { PhonesList, ReloadButton } from "./phones-list";

/**
 * My phones (S06z). The phones that keep a copy of the patient's information offline, with a way to name one, mark it shared, or remove it.
 * Own account only: while acting for someone else the page says so and asks for nothing.
 */
export default async function MyPhonesPage() {
  const { acting } = await getPatientDashboardContext();
  const result = acting ? null : await fetchMyPhones(await createClient());
  const phones = result && result.ok ? buildPhoneViews(result.rows, new Date(), null) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/my-health", label: t("my_health.title") }}
        title={t("my_phones.title")}
        icon={NAV_ICON.passport}
        description={t("my_phones.description")}
      />
      {acting ? (
        <p className="text-sm text-charcoal-ink/70">{t("my_phones.acting")}</p>
      ) : !result || !result.ok ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-red-700">
            {t("my_phones.failed")}
          </p>
          <ReloadButton />
        </div>
      ) : (
        <PhonesList initial={phones} dropped={result.dropped} />
      )}
    </div>
  );
}
