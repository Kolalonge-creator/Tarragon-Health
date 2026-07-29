import type { Metadata } from "next";
import { LegalDocumentPage } from "../_components/legal-document";
import { loadLegalDocument } from "@/lib/marketing/legal-data";
import { absoluteUrl } from "@/lib/marketing/site";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Privacy & Data Processing Consent",
  description:
    "How TarragonHealth collects, uses, and protects your health information, including where it is stored and your rights under Nigerian data protection law.",
  alternates: { canonical: absoluteUrl("/privacy") },
};

export default async function PrivacyPage() {
  const document = await loadLegalDocument("data_processing");
  return <LegalDocumentPage crumbLabel="Legal · Schedule A" document={document} />;
}
