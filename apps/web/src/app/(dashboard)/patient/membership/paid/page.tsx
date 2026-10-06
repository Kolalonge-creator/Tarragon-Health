import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { PaidStatus } from "./paid-status";

export const metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MembershipPaidPage({ searchParams }: { searchParams: SearchParams }) {
  const { uiLanguage } = await getPatientDashboardContext();
  const sp = await searchParams;
  // Paystack appends ?reference=... (and ?trxref=...). Only a well-formed reference is passed on.
  const raw = sp.reference ?? sp.trxref;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const reference = candidate && /^[A-Za-z0-9._=-]{8,100}$/.test(candidate) ? candidate : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Payment" icon={SEMANTIC_ICON.billing} backTo={{ href: "/patient/membership", label: "Membership" }} />
      <PaidStatus reference={reference} locale={uiLanguage} />
    </div>
  );
}
