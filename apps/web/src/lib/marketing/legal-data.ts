import { marketingAnonClient as anonClient } from "./anon-client";
import { parseLegalSections, type LegalSection } from "@/lib/legal/parse-sections";

/**
 * DB-backed legal documents (Data Processing Consent, Telehealth Consent,
 * Terms of Service) for the public marketing site. Reads consent_versions
 * through a BARE anon supabase-js client — same pattern as
 * lib/marketing/resources-data.ts — deliberately not @/lib/supabase/server,
 * so the marketing tree stays free of auth/platform modules. Anon RLS only
 * ever exposes is_current rows (see 20260729120000_legal_consent_v2.sql);
 * draft/superseded versions never reach this loader.
 *
 * Unlike resources-data.ts there is no static fallback duplicating the full
 * text — a hardcoded copy of a legal document could silently drift from the
 * DB row that patient_consents.consent_version_id actually points at, which
 * is a much worse failure mode here than for a marketing article. On error
 * or during an outage this returns null and the page shows a plain
 * "temporarily unavailable" message instead.
 */

export type LegalDocumentType = "data_processing" | "telehealth" | "terms_of_service";

export type LegalDocument = {
  title: string;
  version: string;
  publishedAt: string;
  sections: LegalSection[];
};

export async function loadLegalDocument(
  consentType: LegalDocumentType
): Promise<LegalDocument | null> {
  const client = anonClient();
  if (!client) return null;
  const { data, error } = await client
    .from("consent_versions")
    .select("title, version, body, published_at")
    .eq("consent_type", consentType)
    .eq("is_current", true)
    .maybeSingle();
  if (error || !data) return null;
  return {
    title: data.title,
    version: data.version,
    publishedAt: data.published_at,
    sections: parseLegalSections(data.body),
  };
}
