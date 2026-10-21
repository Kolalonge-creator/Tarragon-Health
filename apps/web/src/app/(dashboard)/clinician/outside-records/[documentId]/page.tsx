import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { signStoragePaths } from "@/lib/supabase/sign-storage-paths";
import { LoadFailure } from "@/components/ui/load-failure";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionForm } from "./decision-form";

export const metadata = { title: "Check an outside record" };
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 600;

interface Opened {
  status: "ok" | "refused" | "not_found";
  path?: string;
  patient_name?: string | null;
  document_type?: string;
  original_filename?: string | null;
  mime_type?: string | null;
  uploaded_at?: string;
  verification_status?: string;
}

/**
 * A clinical-tier doctor checks a record a patient supplied from another hospital (S09y). Opening it is ONE audited read behind the care tie
 * (public.open_outside_record_for_check); a refusal is logged and nothing about the file is shown. The file is shown through a short-lived signed URL
 * minted here, because the bucket has no staff policy. The page never claims the record is part of the clinical record: checking only labels it.
 */
export default async function CheckOutsideRecordPage({ params }: { params: Promise<{ documentId: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!staff || staff.doctor_tier === "care_coordinator") redirect("/clinician");
  const { documentId } = await params;
  if (!z.string().uuid().safeParse(documentId).success) redirect("/clinician/worklists");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_outside_record_for_check", { p_document: documentId });
  if (error) {
    return (
      <LoadFailure>
        This record could not be opened. That does not mean it is missing or checked. Go back to the shared work queues and try again.
      </LoadFailure>
    );
  }
  const opened = (data !== null && typeof data === "object" && !Array.isArray(data) ? data : { status: "not_found" }) as unknown as Opened;
  if (opened.status === "not_found") {
    return <p className="text-sm text-charcoal-ink/70">This record was not found.</p>;
  }
  if (opened.status === "refused") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You are not on this patient&apos;s care team</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-charcoal-ink/80">
          Nothing about this record is shown, and the attempt has been logged. Ask to be added to the patient&apos;s care team, or ask a colleague who is.
        </CardContent>
      </Card>
    );
  }

  const path = opened.path ?? "";
  const signed = path ? (await signStoragePaths("patient-documents", [path], SIGNED_URL_TTL_SECONDS)).get(path) ?? null : null;
  const isPdf = path.toLowerCase().endsWith(".pdf") || opened.mime_type === "application/pdf";
  const decided = opened.verification_status === "verified" || opened.verification_status === "not_verified";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Check an outside record</h1>
        <p className="text-sm text-charcoal-ink/60">
          {opened.patient_name ?? "Patient"} supplied this from another hospital. It is labelled &ldquo;supplied by the patient, not yet checked&rdquo; until a doctor
          checks it, and it is never copied into the clinical record.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{(opened.document_type ?? "document").replace(/_/g, " ")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-charcoal-ink/60">
            {opened.original_filename ?? "Unnamed file"}
            {opened.uploaded_at ? ` · added ${new Date(opened.uploaded_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" })}` : ""}
          </p>
          {signed ? (
            isPdf ? (
              <a href={signed} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline">
                Open the PDF
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL to a private file; next/image would proxy and cache it
              <img src={signed} alt="The record the patient supplied" className="max-h-[70vh] w-auto rounded border" />
            )
          ) : (
            <p role="alert" className="text-sm text-red-700">
              The file could not be loaded just now. That is not a statement about the record. Reload to try again.
            </p>
          )}
          {decided ? (
            <p className="text-sm text-charcoal-ink/80">This record has already been checked. The decision cannot be changed.</p>
          ) : (
            <DecisionForm documentId={documentId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
