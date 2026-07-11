import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { PricingTable } from "../_components/pricing-table";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Pricing — TarragonHealth",
  description:
    "Transparent pricing for TarragonHealth plans in Nigeria (₦) and diaspora (£). No hidden costs — every line item is clearly labelled.",
};

export const revalidate = 3600;

export default function PricingPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple, transparent plans"
          description="Every line item carries exactly one label — included, book & pay, free elsewhere, or add-on. No hidden costs."
        />
        <PricingTable />
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Start monitoring</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.contact}>Talk to us first</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
