import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { fetchPlanPrices } from "@/lib/marketing/plan-prices";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { fromMinorUnits } from "@tarragon/shared";

export const revalidate = 300;

/**
 * Written Result Interpretation.
 *
 * The one paid product on this platform with no dependency on anything else:
 * no partner laboratory, no negotiated rate, no fulfilment chain, no prior
 * relationship. Somebody uploads a PDF from any laboratory in the country and a
 * doctor writes back what it means. That makes it the natural front door, and
 * this page is written for a stranger rather than for an existing patient.
 *
 * WHY IT EXISTS AT ALL. Tarragon stopped selling laboratory tests on
 * 2026-09-10, because what it had recorded as its cost was the laboratory's own
 * published retail price -- so any margin made it dearer than the lab doing the
 * test. Deciding which tests you need stays free. Reading the result is the
 * paid product. This page is the commercial half of that decision.
 *
 * THE HONEST LIMIT, WHICH BELONGS ON THE PAGE. A doctor reading a PDF has not
 * examined the person and cannot diagnose from paper alone. Saying so is not a
 * disclaimer to be minimised: it is the difference between a useful product and
 * one that quietly encourages someone to skip a consultation they need. The FAQ
 * says when to book a visit instead, and that answer must never be softened to
 * protect conversion.
 */

export const metadata: Metadata = pageMetadata({
  title: "Understand your lab results",
  description:
    "Upload a result from any laboratory in Nigeria and a doctor will write back what it means, which figures are outside the normal range, and what to do next.",
  path: MARKETING_ROUTES.resultInterpretation,
});

const STEPS = [
  {
    title: "Upload what you already have",
    body: "A PDF, a photograph of a printed report, whatever the laboratory gave you. From any laboratory or hospital in Nigeria. You do not need to have ordered the test through us, and most people who use this did not.",
  },
  {
    title: "A doctor reads it properly",
    body: "Not a template and not an automatic flag on anything outside the reference range. A doctor on our care team reads the actual figures against your age, sex and anything else on your record.",
  },
  {
    title: "You get it back in writing",
    body: "Which figures are outside the normal range, what that does and does not indicate, what to do next, and what is worth rechecking and when. In plain language, on your record, where you can read it again in six months.",
  },
  {
    title: "And it stops being a one-off",
    body: "The result stays on your record. Next year's version of the same test is a trend rather than another isolated number, which is usually where the actual information is.",
  },
];

const FAQ = [
  {
    question: "Do I have to have used Tarragon before?",
    answer:
      "No. Create a free account, upload the result, and pay for the reading. That is the whole thing. Nothing else has to be set up first.",
  },
  {
    question: "Which laboratories do you accept results from?",
    answer:
      "All of them. Any registered laboratory or hospital in Nigeria, and results from abroad too. We have no commercial relationship with any laboratory and take no cut of what they charged you.",
  },
  {
    question: "Can a doctor diagnose me from this?",
    answer:
      "Sometimes a result is clear enough to act on, and often it is not. A doctor reading a report has not examined you, so what you get is an honest reading of the figures and a clear recommendation about what to do next, which is sometimes to book a proper consultation. If that is the answer, we will say so rather than stretch a written note further than it goes.",
  },
  {
    question: "What if something looks serious?",
    answer:
      "The doctor will tell you plainly and say how quickly to act, including going to a hospital now if that is what the result calls for. We will not leave an urgent finding buried in a paragraph.",
  },
  {
    question: "What if I would rather talk it through?",
    answer:
      "A Result Consultation is a fifteen-minute video call with a doctor going through the same result with you, for people who would rather ask questions as they go. It costs more because it takes more of a doctor's time.",
  },
  {
    question: "Do you sell the tests too?",
    answer:
      "No. We work out which tests you need and write the request, free, and you take it to whichever laboratory you choose and pay them directly at their price. We add nothing and take no cut. Reading the result is the part we charge for.",
  },
];

export default async function ResultInterpretationPage() {
  const prices = await fetchPlanPrices();
  const priceFor = (code: string, fallback: string) => {
    const kobo = prices.get(code);
    return kobo === undefined
      ? fallback
      : `₦${fromMinorUnits(kobo, "NGN").toLocaleString("en-NG")}`;
  };

  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          size="large"
          eyebrow="Written result interpretation"
          title="You have the result. Now what does it mean?"
          description="Upload a result from any laboratory in Nigeria and a doctor will read it and write back what it means, in plain language, on a record that keeps it."
        />

        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            Nigerian laboratories are good at producing results and nobody is paid to explain them.
            You get a page of figures, a reference range, and a couple of numbers printed in bold
            that may or may not matter.
          </p>
          <p>
            So people photograph it and send it to a relative who is a nurse, or search the worst
            possible interpretation, or file it and hope. This is the missing step.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-md rounded-2xl border-2 border-brand-green/30 bg-white px-6 py-5 text-center shadow-sm">
          <p className="font-heading text-4xl font-bold text-brand-green">
            {priceFor("written_result_interpretation", "₦7,500")}
          </p>
          <p className="mt-1 text-sm text-charcoal-ink/65">
            per result, one-off, no account history needed
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How it works" title="Four steps, and none of them involve us selling you a test" />
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
          Not sure which tests you should be having in the first place?{" "}
          <Link
            href={MARKETING_ROUTES.prevention}
            className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green"
          >
            Your screening calendar works that out for free
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <div className="mx-auto max-w-4xl">
          <CtaBand
            variant="gradient"
            title="Upload the result you are holding"
            description="Create a free account, upload it, and a doctor will read it. Nothing else needs setting up, and there is no plan to join."
            primaryLabel="Create a free account"
            secondaryHref={MARKETING_ROUTES.pricing}
            secondaryLabel="See all prices"
          />
        </div>
      </Section>
    </>
  );
}
