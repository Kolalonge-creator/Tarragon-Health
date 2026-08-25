import type { Metadata } from "next";
import { LegalDocumentPage } from "../_components/legal-document";
import { loadLegalDocument } from "@/lib/marketing/legal-data";
import { pageMetadata } from "@/lib/marketing/site";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Terms of Service",
  description:
    "The terms that govern your use of TarragonHealth, including subscriptions, billing, cancellation, and what the platform is and isn't.",
  path: "/terms",
});

export default async function TermsPage() {
  const document = await loadLegalDocument("terms_of_service");
  return <LegalDocumentPage crumbLabel="Legal · Schedule C" document={document} documentKey="terms" />;
}
