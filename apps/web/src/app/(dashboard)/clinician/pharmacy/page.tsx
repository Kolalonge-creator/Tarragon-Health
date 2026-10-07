import { LoadErrorCard } from "@/components/ui/load-error-card";
import { loadPrescriberOverview } from "@/lib/pharmacy-collection/actions";
import { loadPrescriberFlags } from "@/lib/pharmacy-flags/load";
import { PharmacyQuestions } from "./pharmacy-questions";

/**
 * Pharmacy questions and where each prescription has got to (S28, OQ-269). Only prescriptions this clinician signed, and only for
 * patients they are still tied to. Opening the page is one audited read (INV-10) of the new questions and one of the earlier written
 * messages from S36h (read only; pharmacies now ask from a fixed list). Nothing here changes a signed prescription.
 */
export default async function ClinicianPharmacyPage() {
  const [r, earlier] = await Promise.all([loadPrescriberOverview(), loadPrescriberFlags()]);
  if (!r.ok) return <LoadErrorCard title="Pharmacy questions" what="the pharmacy questions and collections" />;
  return <PharmacyQuestions overview={r.overview} earlier={earlier.ok ? earlier.data : null} />;
}
