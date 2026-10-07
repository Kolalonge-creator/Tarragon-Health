import { LoadErrorCard } from "@/components/ui/load-error-card";
import { loadPrescriberOverview } from "@/lib/pharmacy-collection/prescriber-actions";
import { PharmacyQuestions } from "./pharmacy-questions";

/**
 * Pharmacy questions and where each prescription has got to (S28, OQ-288). Only prescriptions this clinician signed, and only for patients
 * they are still tied to. Opening the page is one audited read (INV-10), including S36h's earlier written messages (read only: pharmacies now
 * ask from a fixed list). Nothing here changes a signed prescription.
 */
export default async function ClinicianPharmacyPage() {
  const r = await loadPrescriberOverview();
  if (!r.ok) return <LoadErrorCard title="Pharmacy questions" what="the pharmacy questions and collections" />;
  return <PharmacyQuestions overview={r.overview} />;
}
