import { LoadErrorCard } from "@/components/ui/load-error-card";
import { loadPrescriberOverview } from "@/lib/pharmacy-collection/actions";
import { PharmacyQuestions } from "./pharmacy-questions";

/**
 * Pharmacy questions and where each prescription has got to (S28, OQ-239). Only prescriptions this clinician signed, and only for
 * patients they are still tied to. Opening the page is one audited read (INV-10). The questions are a fixed list and the answers
 * are too: nothing here changes a signed prescription.
 */
export default async function ClinicianPharmacyPage() {
  const r = await loadPrescriberOverview();
  if (!r.ok) return <LoadErrorCard title="Pharmacy questions" what="the pharmacy questions and collections" />;
  return <PharmacyQuestions overview={r.overview} />;
}
