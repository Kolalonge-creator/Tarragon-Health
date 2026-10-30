import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section, SectionHeading } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { loadResourceArticles } from "@/lib/marketing/resources-data";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("obesity");
  return content?.metadata ?? {};
}

export default async function ObesityPage() {
  const content = getProductPage("obesity");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const weightArticles = articles.filter((a) => a.category === "Weight");

  return (
    <ProductPageTemplate content={content}>
      <Section>
        <SectionHeading
          eyebrow="Try it yourself"
          title="Where do you stand today?"
          description="Two free tools, with no sign-up needed: check your body mass index (BMI) range, or see how active a typical week is for you."
        />
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
          <Link
            href={MARKETING_ROUTES.bmiCalculator}
            className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition-colors hover:border-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              BMI and Calorie Calculator →
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Shows your BMI range and an estimated daily calorie target.
            </p>
          </Link>
          <Link
            href={MARKETING_ROUTES.activityCalculator}
            className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition-colors hover:border-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Activity Intensity Calculator →
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Shows the calories you burn and how a session counts towards your weekly activity guideline.
            </p>
          </Link>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            What to expect
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            This programme is lifestyle-led and doctor-reviewed. It does not currently include
            weight-loss medication (such as GLP-1 injections) or any other prescribing specific
            to weight. If you are looking for that, say so at your first review, and your doctor can
            explain the options available elsewhere.
          </p>
        </div>
      </Section>

      {weightArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel
            title="More resources on weight management"
            articles={weightArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
