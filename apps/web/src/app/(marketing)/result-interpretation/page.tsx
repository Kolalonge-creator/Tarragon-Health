import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const revalidate = 300;

/**
 * Understanding a laboratory result.
 *
 * Founder decision 2026-11-03: reading a result with a doctor is part of
 * Membership, not a product of its own. The Written Result Interpretation and
 * Result Consultation catalogue rows are inactive and nobody has ever bought
 * one, so this page no longer sells a reading. What is true on every plan:
 * uploading is free, every result is checked against the normal range, and an
 * abnormal result reaches a doctor within 24 hours (12 if critical). What
 * Membership adds: a doctor on your care team goes through any result with
 * you, on the monthly video call or in a written question between calls.
 * The page is still written for a stranger holding a report, because that is
 * who arrives here from search.
 *
 * THE HONEST LIMIT, WHICH BELONGS ON THE PAGE. A doctor reading a PDF has not
 * examined the person and cannot diagnose from paper alone. Saying so is not a
 * disclaimer to be minimised: it is the difference between a useful product and
 * one that quietly encourages someone to skip a consultation they need. The FAQ
 * says when to book a visit instead, and that answer must never be softened to
 * protect conversion.
 */

export const metadata: Metadata = pageMetadata({
  title: "Understand your laboratory results",
  description:
    "Upload a result from any laboratory in Nigeria. Anything abnormal reaches a doctor on every plan; with Membership a doctor goes through it with you.",
  path: MARKETING_ROUTES.resultInterpretation,
});

const STEPS = [
  {
    title: "Upload what you already have",
    body: "A PDF, a photograph of a printed report, or whatever the laboratory gave you, from any laboratory or hospital in Nigeria. You do not need to have arranged the test through us. Uploading is free on every plan.",
  },
  {
    title: "Anything abnormal reaches a doctor",
    body: "Every result is checked against the normal range. A figure outside it goes to a doctor within 24 hours, or within 12 hours if it is critical, on every plan including Free. That is not an automatic flag left on your record: a doctor looks at it and tells you what it means.",
  },
  {
    title: "With Membership, a doctor goes through it with you",
    body: "On your monthly video call, or as a written question between calls, a doctor on your care team reads the actual figures against your age, sex and the rest of your record: what is outside the normal range, what that does and does not indicate, what to do next, and what is worth rechecking and when. The answer stays on your record in plain language.",
  },
  {
    title: "It becomes part of your history",
    body: "The result stays on your record. Next year's version of the same test then shows a trend instead of another isolated number, and the trend is usually where the useful information is.",
  },
];

const FAQ = [
  {
    question: "Do I have to have used Tarragon before?",
    answer:
      "No. Create a free account and upload the result. If a figure is outside the normal range, a doctor looks at it on every plan. If you want a doctor to go through the whole result with you, that is part of Membership.",
  },
  {
    question: "Which laboratories do you accept results from?",
    answer:
      "All of them. We accept results from any registered laboratory or hospital in Nigeria, and from abroad. You choose the laboratory and pay it directly; we take no commission on what it charged you.",
  },
  {
    question: "Can a doctor diagnose me from this?",
    answer:
      "Sometimes a result is clear enough to act on, and often it is not. A doctor reading a report has not examined you, so what you get is an honest reading of the figures and a clear recommendation about what to do next, which is sometimes to be seen in person. If that is the answer, we will say so rather than stretch a reading further than it goes.",
  },
  {
    question: "What if something looks serious?",
    answer:
      "The doctor will tell you plainly and say how quickly to act, including going to a hospital now if that is what the result calls for. We will not leave an urgent finding buried in a paragraph.",
  },
  {
    question: "What if I would rather talk it through?",
    answer:
      "With Membership, bring the result to your monthly video call with your care team, or send it as a written question between calls. Either way a doctor goes through it with you and the answer stays on your record.",
  },
  {
    question: "Do you sell the tests too?",
    answer:
      "No. We work out which tests you need and write the request, free of charge, and you take it to whichever laboratory you choose and pay the laboratory directly at its price. We add nothing and take no commission.",
  },
];

export default function ResultInterpretationPage() {
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          size="large"
          eyebrow="Understanding your result"
          title="You have your result. What does it mean?"
          description="Upload a result from any laboratory in Nigeria. Anything abnormal reaches a doctor on every plan, and with Membership a doctor goes through the whole result with you, in plain language, on a record that keeps it."
        />

        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            Nigerian laboratories produce results well, but nobody is paid to explain them.
            You receive a page of figures, a reference range, and a few numbers printed in bold
            that may or may not matter.
          </p>
          <p>
            As a result, people photograph the report and send it to a relative who is a nurse, search
            online and find the worst possible explanation, or file it away and hope for the best.
            Tarragon provides the missing step.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-md rounded-2xl border-2 border-brand-green/30 bg-white px-6 py-5 text-center shadow-sm">
          <p className="font-heading text-2xl font-bold text-brand-green">Free to upload</p>
          <p className="mt-1 text-sm text-charcoal-ink/65">
            An abnormal result reaches a doctor on every plan. With Membership, your care team goes through any result with you. Prices are on the pricing page.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How it works" title="Four steps, and we never sell you a test" />
        <ol className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <p className="font-mono text-xs font-semibold text-brand-green">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 font-heading text-lg font-semibold text-charcoal-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionHeading eyebrow="Questions people ask" title="Before you upload" />
        <div className="mx-auto max-w-3xl">
          <FaqAccordion items={FAQ} />
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/60">
          If you are not sure which tests you should have,{" "}
          <Link
            href={MARKETING_ROUTES.prevention}
            className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green"
          >
            your screening calendar works that out for free
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <div className="mx-auto max-w-4xl">
          <CtaBand
            variant="gradient"
            title="Upload the result you are holding"
            description="Create a free account and upload it. Anything abnormal reaches a doctor. Join Membership when you want a doctor to go through every result with you."
            primaryLabel="Create your free account"
            secondaryHref={MARKETING_ROUTES.pricing}
            secondaryLabel="See pricing"
          />
        </div>
      </Section>
    </>
  );
}
