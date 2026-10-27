import type { Metadata } from "next";
import { plainStatement } from "@tarragon/i18n";
import { Section } from "../_components/section";
import { PlainStatementView } from "@/components/plain-statement/plain-statement";
import { readPlainStatementInput } from "@/lib/plain-statement-input";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Pricing and accessibility",
  description:
    "A one-page plain statement: how we handle your information, what is free, what costs money, and what the app does for large text, screen readers and audio.",
  path: MARKETING_ROUTES.pricingAndAccessibility,
});

export const revalidate = 3600;

export default async function PricingAndAccessibilityPage() {
  const statement = plainStatement(await readPlainStatementInput("public"));
  return (
    <Section className="pt-20">
      <article className="mx-auto max-w-2xl">
        <PlainStatementView
          statement={statement}
          headingLevel="h1"
          privacyHref={MARKETING_ROUTES.privacy}
          accessibilityHref={MARKETING_ROUTES.accessibility}
          pricingHref={MARKETING_ROUTES.pricing}
        />
      </article>
    </Section>
  );
}
