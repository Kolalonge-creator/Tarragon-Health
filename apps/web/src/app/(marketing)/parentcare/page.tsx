import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export function generateMetadata() {
  const content = getProductPage("parentcare");
  return content?.metadata ?? {};
}

export default function ParentCarePage() {
  const content = getProductPage("parentcare");
  if (!content) notFound();
  return (
    <ProductPageTemplate content={content}>
      <Section>
        <p className="mx-auto max-w-2xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          Funding a parent&apos;s care from abroad and want to make it a gift, or introduce a
          sibling to how it works?{" "}
          <Link
            href={MARKETING_ROUTES.gift}
            className="font-semibold text-brand-green underline underline-offset-2"
          >
            See how gifting Tarragon works
          </Link>
          .
        </p>
      </Section>
    </ProductPageTemplate>
  );
}
