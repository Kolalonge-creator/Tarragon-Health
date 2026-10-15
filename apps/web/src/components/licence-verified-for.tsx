import { createClient } from "@/lib/supabase/server";
import { fetchLicenceVerifiedOn } from "@/lib/clinical/licence-verified";
import { LicenceVerifiedBadge } from "@/components/licence-verified-badge";

/** Server-side wrapper: looks the date up for one clinician (clinical_staff id or profile id) and renders the shared badge, or nothing. */
export async function LicenceVerifiedFor({ id, className }: { id: string | null | undefined; className?: string }) {
  if (!id) return null;
  const dates = await fetchLicenceVerifiedOn(await createClient(), [id]);
  return <LicenceVerifiedBadge verifiedOn={dates.get(id)} className={className} />;
}
