import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { getFhirExportData } from "./get-export-data";
import {
  buildPatientResource,
  buildVitalsObservations,
  buildBloodProfileObservations,
  buildScreeningObservations,
  buildAllergyIntoleranceResources,
  buildMedicationStatementResources,
  buildImmunizationResources,
  buildCarePlanResources,
  buildEncounterResources,
  buildDocumentReferenceResources,
} from "./resources";
import type { Bundle, BundleEntry, FhirResourceBase } from "../types";

/**
 * Pure assembly: a flat resource list -> a FHIR collection Bundle. No I/O,
 * fully unit-testable without a DB.
 */
export function assembleExportBundle(resources: FhirResourceBase[]): Bundle {
  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: resources.map((resource): BundleEntry => ({ resource })),
  };
}

/**
 * A "take it and leave" export the patient may reopen hours later, so
 * DocumentReference links get a much longer-lived signed URL than the
 * ~5-minute one used for in-app viewing (signResultDocumentPath). Uses the
 * service-role client for the same reason that helper does: org staff/the
 * caller has no direct storage-object read policy, and the caller must
 * already have read the lab_result_documents ROW through their own RLS
 * session (enforced by get-export-data.ts's query) before a URL is minted.
 */
async function signForExport(filePath: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(RESULT_DOC_BUCKET).createSignedUrl(filePath, 60 * 60 * 24);
  return data?.signedUrl ?? null;
}

export async function buildFhirExportBundle(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<Bundle> {
  const data = await getFhirExportData(supabase, patientId, organisationId);

  const signedUrlById = new Map<string, string | null>();
  await Promise.all(
    data.documents.map(async (doc) => {
      signedUrlById.set(doc.id, await signForExport(doc.file_path));
    })
  );

  const resources: FhirResourceBase[] = [
    buildPatientResource(data.profile),
    ...buildVitalsObservations(patientId, data.vitals),
    ...buildBloodProfileObservations(patientId, data.bloodProfile),
    ...buildScreeningObservations(patientId, data.screenings),
    ...buildAllergyIntoleranceResources(patientId, data.allergies),
    ...buildMedicationStatementResources(patientId, data.medications),
    ...buildImmunizationResources(patientId, data.immunizations),
    ...buildCarePlanResources(patientId, data.carePlans),
    ...buildEncounterResources(patientId, data.hospitalAdmissions),
    ...buildDocumentReferenceResources(patientId, data.documents, signedUrlById),
  ];

  return assembleExportBundle(resources);
}
