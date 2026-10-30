import type { Metadata } from "next";
import { LegalDocumentPage } from "../_components/legal-document";
import { loadLegalDocument } from "@/lib/marketing/legal-data";
import { dataProtectionLines } from "@/lib/marketing/data-protection-contacts";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Privacy & Data Processing Consent",
  description:
    "How TarragonHealth collects, uses, and protects your health information, including where it is stored and your rights under Nigerian data protection law.",
  path: MARKETING_ROUTES.privacy,
});

export default async function PrivacyPage() {
  const document = await loadLegalDocument("data_processing");
  return (
    <>
      <LegalDocumentPage crumbLabel="Legal · Schedule A" document={document} documentKey="privacy" />
      <section aria-labelledby="data-protection-contact" className="mx-auto max-w-3xl px-4 pb-16 text-sm leading-relaxed text-charcoal-ink/80">
        <h2 id="data-protection-contact" className="font-heading text-lg font-semibold text-charcoal-ink">
          Data protection contact
        </h2>
        {dataProtectionLines().map((line) => (
          <p key={line} className="mt-2">
            {line}
          </p>
        ))}
      </section>
    </>
  );
}
