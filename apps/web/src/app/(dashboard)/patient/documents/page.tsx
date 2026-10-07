import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { t } from "@tarragon/i18n";
import { DOCUMENT_CAPTURE_GUARD } from "@/lib/document-capture/run";
import { DocumentCapture } from "./document-capture";
import { DocumentList, type DocumentRow } from "./document-list";

/**
 * Photos of paper results, prescriptions, vaccination cards and discharge
 * summaries (S43, spec 2.3). The photo is always kept. When reading is open the
 * app reads the printed details into SUGGESTIONS and the person confirms or
 * drops each one; nothing unconfirmed is part of the record.
 */
export default async function DocumentsPage() {
  const { subjectId, profile, uiLanguage } = await getPatientDashboardContext();
  const supabase = await createClient();
  const isOwn = subjectId === profile.id;

  const [{ data: docs }, { data: open }] = await Promise.all([
    supabase
      .from("patient_documents")
      .select("id, document_type, original_filename, created_at, ocr_state, extracted, file_path")
      .eq("patient_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("go_live_guard_is_open", { p_key: DOCUMENT_CAPTURE_GUARD }),
  ]);

  const rows: DocumentRow[] = [];
  for (const d of docs ?? []) {
    let photoUrl: string | null = null;
    if (isOwn) {
      const { data: signed } = await supabase.storage.from("patient-documents").createSignedUrl(d.file_path, 600);
      photoUrl = signed?.signedUrl ?? null;
    }
    rows.push({
      id: d.id,
      documentType: d.document_type,
      filename: d.original_filename,
      createdAt: d.created_at,
      ocrState: d.ocr_state,
      fields: (d.extracted as { fields?: DocumentRow["fields"] } | null)?.fields ?? [],
      photoUrl,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: t("passport.back", uiLanguage) }}
        title={t("passport.documents.title", uiLanguage)}
        icon={NAV_ICON.upload}
        description={t("passport.documents.description", uiLanguage)}
      />
      {isOwn && profile.organisation_id ? (
        <DocumentCapture patientId={subjectId} organisationId={profile.organisation_id} readingOpen={open === true} locale={uiLanguage} />
      ) : (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("passport.documents.own_only", uiLanguage)}</p>
      )}
      <DocumentList rows={rows} canConfirm={isOwn} locale={uiLanguage} />
    </div>
  );
}
