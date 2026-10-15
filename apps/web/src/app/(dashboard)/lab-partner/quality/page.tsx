import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { PartnerQualityCard } from "@/components/partner-portal/quality-card";
import { partnerQualitySchema } from "@/lib/partner-network/model";

export const metadata = { title: "Your quality check" };
export const dynamic = "force-dynamic";

export default async function LabPartnerQualityPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "lab_partner") {
    return <div className="mx-auto max-w-3xl p-6"><p className="text-sm text-charcoal-ink/70">This area is for partner laboratories.</p></div>;
  }
  const { data, error } = await loose(await createClient()).rpc("partner_my_quality");
  const parsed = error ? null : partnerQualitySchema.safeParse(data);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Your quality check</h1>
        <p className="text-charcoal-ink/60">
          Tarragon looks at how quickly results come back, complaints and your licence every night. Patients pay your laboratory directly, so there is no settlement statement for laboratories.
        </p>
      </div>
      {parsed?.success ? <PartnerQualityCard q={parsed.data} /> : <p role="alert" className="text-sm text-red-600">Your quality check could not be loaded. This is not the same as there being nothing to show.</p>}
    </div>
  );
}
