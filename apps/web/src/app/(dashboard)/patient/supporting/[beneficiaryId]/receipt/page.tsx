import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { CareReceiptView } from "./care-receipt-view";

/**
 * The care receipt for one person, one month.
 *
 * No access check here beyond "is this a signed-in patient account". That is
 * deliberate and not an oversight: public.care_receipt refuses any caller
 * without a profile_access grant over the beneficiary, and decides the
 * disclosure tier from the patient's own live consent. Re-deriving either in
 * this file would create a second copy of the rule that could drift from the
 * first, and the copy in the database is the one that actually protects
 * anything. The route reads a uuid out of the URL and hands it over; guessing
 * somebody else's uuid gets you a refusal from Postgres.
 */
export default async function CareReceiptPage({
  params,
}: {
  params: Promise<{ beneficiaryId: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  const { beneficiaryId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/patient/supporting"
          className="text-sm text-brand-green underline print:hidden"
        >
          Back to people you support
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink">
          Care receipt
        </h1>
        <p className="max-w-2xl text-charcoal-ink/60">
          What the care actually involved, month by month, taken straight from the record.
        </p>
      </div>

      <CareReceiptView beneficiaryId={beneficiaryId} />
    </div>
  );
}
