import type { Metadata } from "next";
import { AudienceTabs } from "../_components/audience-tabs";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { AUDIENCE_TABS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Who it's for",
  description:
    "TarragonHealth is built for individuals managing their health, families looking after a parent, employers, and HMOs.",
  alternates: { canonical: MARKETING_ROUTES.whoItsFor },
};

export default function WhoItsForPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Who it's for"
          title="Whoever you're looking after, Tarragon speaks your language."
          description="The same connected record works whether you're managing your own health, keeping watch over a parent, or overseeing a whole workforce or membership."
        />
        <AudienceTabs tabs={AUDIENCE_TABS} />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          title="Find the plan that fits you"
          description="Clear plans with no hidden costs, for individuals, families, and organisations."
          primaryHref={MARKETING_ROUTES.pricing}
          primaryLabel="View pricing"
          secondaryHref="/signup"
          secondaryLabel="Start monitoring"
        />
      </Section>
    </>
  );
}
