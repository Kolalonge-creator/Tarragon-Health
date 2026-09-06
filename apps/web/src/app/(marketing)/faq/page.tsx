import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { FAQ_CATEGORY_LABEL, HOMEPAGE_FAQS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

const FAQ_GROUPS = [
  {
    category: "general" as const,
    description: "How the product works, day to day.",
  },
  {
    category: "clinical" as const,
    description: "Doctor involvement, escalation, and what a “review” actually means.",
  },
];

export const metadata: Metadata = pageMetadata({
  title: "FAQ",
  description:
    "Clear answers about how TarragonHealth works, what's included, and how care and escalation happen, before you sign up.",
  path: MARKETING_ROUTES.faq,
});

/** FAQPage structured data; eligible for the FAQ rich result in search. */
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: HOMEPAGE_FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Questions"
          title="What families usually ask first"
          description="Clear answers before anyone signs up, because trust starts with knowing what is included."
        />
        <div className="mx-auto max-w-4xl space-y-12">
          {FAQ_GROUPS.map((group) => {
            const faqs = HOMEPAGE_FAQS.filter((faq) => faq.category === group.category);
            if (faqs.length === 0) return null;
            return (
              <div key={group.category}>
                <div className="mb-4">
                  <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-brand-green">
                    {FAQ_CATEGORY_LABEL[group.category]}
                  </h2>
                  <p className="mt-1 text-sm text-charcoal-ink/60">{group.description}</p>
                </div>
                <div className="grid gap-4">
                  {faqs.map((faq) => (
                    <details
                      key={faq.question}
                      className="group rounded-xl border border-charcoal-ink/10 bg-white p-5"
                    >
                      <summary className="cursor-pointer list-none font-heading text-lg font-semibold text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2">
                        {faq.question}
                        <span className="float-right ml-4 text-brand-green transition-transform group-open:rotate-45">
                          +
                        </span>
                      </summary>
                      <p className="mt-3 text-charcoal-ink/70">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mx-auto mt-8 max-w-4xl text-center text-sm text-charcoal-ink/70">
          Still have a question? See the full breakdown on our{" "}
          <Link href={MARKETING_ROUTES.pricing} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            pricing page
          </Link>{" "}
          or{" "}
          <Link href={MARKETING_ROUTES.contact} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            get in touch
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          title="Ready when you are"
          description="Get started today, for yourself or someone you love."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
