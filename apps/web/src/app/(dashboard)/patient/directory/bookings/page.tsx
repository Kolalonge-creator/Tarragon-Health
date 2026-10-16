import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { BookingsList } from "./bookings-list";

export const metadata = { title: "Your visits" };

export default async function BookingsPage() {
  const { uiLanguage } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title={t("directory.bookings.title", uiLanguage)} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/directory", label: t("directory.title", uiLanguage) }} />
      <BookingsList locale={uiLanguage} />
    </div>
  );
}
