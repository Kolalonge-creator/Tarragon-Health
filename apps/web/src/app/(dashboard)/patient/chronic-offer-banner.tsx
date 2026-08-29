import { createClient } from "@/lib/supabase/server";
import { ChronicOfferCard } from "./chronic-offer-card";

/** Server wrapper: fetches the patient's own open offer (RLS-scoped to
 * `patient_id = auth.uid()`) and renders nothing at all when there isn't
 * one — this must never be a nagging banner for someone who was never
 * offered anything. */
export async function ChronicOfferBanner({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data: offer } = await supabase
    .from("chronic_programme_offers")
    .select("*")
    .eq("patient_id", patientId)
    .eq("status", "offered")
    .maybeSingle();

  if (!offer) return null;
  return <ChronicOfferCard offer={offer} />;
}
