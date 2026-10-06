import { createClient } from "@/lib/supabase/server";
import { LoadErrorCard } from "@/components/ui/load-error-card";
import { parseInbox } from "@/lib/pharmacy-collection/collection";
import { PharmacistPrescriptions } from "./pharmacist-prescriptions";

/**
 * Prescriptions patients have sent to this pharmacy for collection (S28). The list shows a collection code, a first name and
 * a medicine count only; a prescription's detail is opened one at a time and every opening is audited by the database.
 */
export default async function PharmacistPrescriptionsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacy_inbox");
  if (error) {
    const off = error.message.includes("pharmacy_collection_off");
    return off ? (
      <p className="text-sm text-charcoal-ink/70">Pharmacy collection is not switched on yet. Nothing is waiting.</p>
    ) : (
      <LoadErrorCard title="Prescriptions for collection" what="the prescriptions sent to your pharmacy" />
    );
  }
  const rows = parseInbox(data);
  if (!rows) return <LoadErrorCard title="Prescriptions for collection" what="the prescriptions sent to your pharmacy" />;
  return <PharmacistPrescriptions rows={rows} />;
}
