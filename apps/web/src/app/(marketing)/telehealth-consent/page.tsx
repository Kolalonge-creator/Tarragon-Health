import type { Metadata } from "next";
import { LegalDocumentPage } from "../_components/legal-document";
import { loadLegalDocument } from "@/lib/marketing/legal-data";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Telehealth Consent",
  description:
    "Your consent to receive remote clinical review and monitoring from TarragonHealth's doctors, how our care team is structured, and the emergency-care carve-out.",
  path: MARKETING_ROUTES.telehealthConsent,
});

export default async function TelehealthConsentPage() {
  const document = await loadLegalDocument("telehealth");
  return (
    <LegalDocumentPage
      crumbLabel="Legal · Schedule B"
      document={document}
      documentKey="telehealthConsent"
    />
  );
}
