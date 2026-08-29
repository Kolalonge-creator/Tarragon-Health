import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { loadPatientDocuments } from "@/lib/documents/documents";
import { UploadDocumentForm } from "./upload-document-form";
import { DocumentList } from "./document-list";

/**
 * The patient-facing document library — any document a patient wants kept on
 * their record (referral letters, discharge summaries, insurance documents,
 * old prescriptions, etc.), on top of the metadata-only patient_documents
 * table whose lifecycle/RLS is already fully built. Uses subjectId from
 * getPatientDashboardContext (not the logged-in user's own id) so a
 * supporter acting for a dependent sees that dependent's documents here too,
 * matching the pattern in patient/(sections)/labs/page.tsx and
 * patient/learn/page.tsx.
 */
export default async function PatientDocumentsPage() {
  const { subjectId } = await getPatientDashboardContext();

  const supabase = await createClient();
  const documents = await loadPatientDocuments(supabase, subjectId);

  return (
    <div className="mx-auto max-w-3xl py-6">
      <DashboardSection
        id="documents"
        title="Documents"
        description="Referral letters, discharge summaries, insurance documents, and anything else you want kept on your record."
      >
        <UploadDocumentForm />
        <DocumentList documents={documents} />
      </DashboardSection>
    </div>
  );
}
