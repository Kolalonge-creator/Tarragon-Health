import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { companyProfileSchema } from "@/lib/finance/schemas";
import { CompanyProfileForm } from "./company-profile-form";

/**
 * The legal-identity facts every printed government-filing/investor/audit
 * report (finance/reports/print/[pack]) puts on its letterhead — RC number,
 * TIN, registered address, directors, auditor. Company-secretarial data, so
 * it lives here rather than in the finance console: a true super admin edits
 * it, finance only ever reads it (finance_company_profile_get, gated by
 * private.is_finance()). See 20260812041237_finance_company_profile_and_
 * extended_compliance.sql.
 */
export default async function CompanyProfileSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("finance_company_profile_get");
  const parsed = companyProfileSchema.safeParse(data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company & legal profile"
        description="The registered facts every printed report puts on its letterhead: CAC particulars, FIRS TIN/VAT number, registered address, directors, auditor and settlement bank details. Kept here rather than in Finance because this is company-secretarial data, not bookkeeping; Finance's Reports & Filings pack (Finance → Reports) reads it read-only."
      />
      <CompanyProfileForm initial={parsed.success ? parsed.data : companyProfileSchema.parse({})} />
    </div>
  );
}
