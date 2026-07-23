import { B2bPageTemplate } from "../_components/b2b-page-template";
import { Section } from "../_components/section";
import { CorporateQuoteCalculator } from "../_components/corporate-quote-calculator";
import { B2B_PAGES } from "../_content/b2b";

export function generateMetadata() {
  return B2B_PAGES.corporate.metadata;
}

export default function CorporatePage() {
  return (
    <>
      <B2bPageTemplate content={B2B_PAGES.corporate} />
      <Section className="pb-20">
        <CorporateQuoteCalculator />
      </Section>
    </>
  );
}
