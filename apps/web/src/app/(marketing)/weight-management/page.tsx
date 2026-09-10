import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { WEIGHT_MANAGEMENT } from "../_content/pricing";
import { fetchPlanPrices } from "@/lib/marketing/plan-prices";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { fromMinorUnits } from "@tarragon/shared";

export const revalidate = 300;

/**
 * Supervised Weight Management.
 *
 * THE RULE THIS PAGE EXISTS UNDER, AND IT IS NOT NEGOTIABLE COPY POLISH.
 *
 * Tarragon does not prescribe, sell or supply weight-loss medication, and is
 * not a pharmacy. It supervises people who obtain their own. That is enforced
 * in the database -- private.enforce_weight_management_supervision_only refuses
 * an enrolment against any medication whose source is not the patient's own --
 * so a page that implied otherwise would be selling something the platform
 * physically cannot deliver.
 *
 * This is also the single most over-promised category in consumer health right
 * now, in a market where a four-week pen costs several hundred thousand naira
 * and nobody is checking whether the buyer should be taking it. So the
 * disclosure is above the fold, not in a footnote, and the page says plainly
 * that the honest answer might be no. A landing page that reads like a supply
 * route is the failure mode; the brand voice rules already forbid fear-based
 * urgency, and inventing eligibility a doctor has not confirmed would be worse
 * than urgent, it would be untrue.
 *
 * Prices come from service_products at request time, with the strings in
 * _content/pricing.ts as fallback -- never hardcode one here. Advertising a
 * number the checkout does not charge is a mistake this site has made before,
 * most recently with a video visit shown at one price and billed at another.
 */

export const metadata: Metadata = pageMetadata({
  title: "Supervised weight management",
  description:
    "A doctor supervising weight-loss medication you obtain yourself: whether it suits you, at what dose, what to watch for, and a review every month. Tarragon does not prescribe or supply the medicine.",
  path: MARKETING_ROUTES.weightManagement,
});

const WHAT_A_DOCTOR_ACTUALLY_DOES = [
  {
    title: "Decides whether you should be on it at all",
    body: "A proper assessment before anything starts: your BMI and waist, what else you are managing, what you already take, and the conditions that make this medication a bad idea. If the answer is that it is not right for you, you get told that, and you have not wasted a month finding out.",
  },
  {
    title: "Owns the dose plan",
    body: "Escalation is where most people run into trouble, and the answer is rarely the schedule printed on the leaflet. Your doctor agrees each step with you, and holds it when your body says to hold it.",
  },
  {
    title: "Watches for what matters",
    body: "A tolerability check-in every two weeks, read by a clinician. Nausea and constipation are common and usually manageable. Severe pain that goes through to your back is not, and reporting it reaches a doctor the same day rather than at your next review.",
  },
  {
    title: "Keeps an eye on the rest of you",
    body: "Weight is not the only thing that moves. Your blood pressure and blood sugar are monitored throughout, and a dangerous reading reaches a doctor rather than sitting on your record.",
  },
  {
    title: "Reviews you every month, in writing",
    body: "What changed, what it means, and what happens next, on your record where you can read it again later.",
  },
];

const FAQ = [
  {
    question: "Do you prescribe the medication?",
    answer:
      "No. Tarragon does not prescribe, sell or supply weight-loss medication, and we are not a pharmacy. You obtain your own prescription and your own medicine. What you are paying us for is a doctor taking responsibility for how it is used.",
  },
  {
    question: "Then what am I actually paying for?",
    answer:
      "The part a pharmacy cannot give you. Whether this medication suits you, at what dose, what to do when something changes, and someone reading your check-ins who will notice if something is going wrong. The medicine is the easy part to buy in Nigeria; the supervision is the part nobody is selling.",
  },
  {
    question: "What if I have not started yet?",
    answer:
      "That is the better time to speak to us. A doctor can tell you whether it is a sensible option for you before you have spent anything on it, and what to have checked first.",
  },
  {
    question: "Do I need blood tests?",
    answer:
      "A baseline is recommended so your doctor knows where you started. We work out which tests and write the request; you take it to whichever laboratory you choose and pay them directly, at their price. We add nothing and take no cut.",
  },
  {
    question: "Does this renew automatically?",
    answer:
      "No. You pay once for the term you choose and it stops at the end. No card is kept on file and there is nothing to cancel. We tell you before it ends.",
  },
  {
    question: "What if I want to stop?",
    answer:
      "Stopping is a clinical decision like starting one, and your doctor will talk it through with you, including what tends to happen to weight afterwards. Nobody will pressure you to continue; we are not selling you the medicine.",
  },
  {
    question: "Is weight coaching without medication still free?",
    answer:
      "Yes, and it stays free. Weight tracking, goals, meal and activity logging, the structured diet and exercise tracks and the AI Health Coach cost nothing and have no time limit. This page is only for people taking medication who want a doctor supervising it.",
  },
];

export default async function WeightManagementPage() {
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
          eyebrow="Supervised weight management"
          title="Someone medically responsible for how you use it"
          description="If you are taking weight-loss medication, or thinking about starting, a doctor can supervise it: whether it suits you, at what dose, what to watch for, and what to do when something changes."
        />

        {/* Above the fold on purpose. Anyone arriving here from a search for
            the drug itself needs to know within one screen that this is not a
            supply route, so they can leave rather than be strung along. */}
        <div className="mx-auto max-w-3xl rounded-2xl border-l-4 border-clinical-navy bg-soft-sage px-6 py-5">
          <p className="font-heading text-lg font-semibold text-clinical-navy">
            We do not sell the medicine
          </p>
          <p className="mt-2 text-base leading-relaxed text-charcoal-ink/80">
            {WEIGHT_MANAGEMENT.disclosure}
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            These medicines work, and they are widely available here. What is much harder to find is
            a doctor who will tell you honestly whether you should be on one, what dose to move to
            and when, and what the symptom you have had for three days actually means.
          </p>
          <p>
            That gap is the reason people end up asking a pharmacist, a group chat, or nobody at
            all. It is also where almost everything that goes wrong on this medication starts.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What supervision means here"
          title="Five things a doctor does, that a pharmacy does not"
        />
        <ol className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
          {WHAT_A_DOCTOR_ACTUALLY_DOES.map((item, index) => (
            <li
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <p className="font-mono text-xs font-semibold text-brand-green">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 font-heading text-lg font-semibold text-charcoal-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">{item.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="What it costs"
          title="Paid once, for the term you choose"
          description="Longer terms cost less per month because the work is heaviest at the start, while a doctor is deciding whether this suits you and getting your dose right."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {WEIGHT_MANAGEMENT.terms.map((term) => (
            <div
              key={term.code}
              className="flex flex-col rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <p className="text-sm font-medium uppercase tracking-wide text-charcoal-ink/55">
                {term.label}
              </p>
              <p className="mt-1 font-heading text-3xl font-bold text-brand-green">
                {priceFor(term.code, term.price)}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{term.perMonth}</p>
            </div>
          ))}
        </div>

        <ul className="mx-auto mt-8 max-w-3xl space-y-2">
          {WEIGHT_MANAGEMENT.includes.map((line) => (
            <li key={line} className="flex items-start gap-3 text-base text-charcoal-ink/80">
              <span
                aria-hidden
                className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-6 max-w-3xl text-sm leading-relaxed text-charcoal-ink/60">
          Nothing renews on its own, no card is kept on file, and there is nothing to cancel. You
          buy the medicine separately, from wherever you already buy it. Baseline blood tests are
          recommended and are paid to whichever laboratory you choose, at their price.
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Not taking medication"
          title="Then none of this costs you anything"
          description="Weight tracking, goals, meal and activity logging, the structured diet and exercise tracks and the AI Health Coach are all free, with no time limit and no card required."
        />
        <div className="mx-auto max-w-3xl text-center">
          <Link
            href={MARKETING_ROUTES.obesity}
            className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green"
          >
            See how weight is managed without medication
          </Link>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Questions people actually ask" title="Before you start" />
        <div className="mx-auto max-w-3xl">
          <FaqAccordion items={FAQ} />
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto max-w-4xl">
          <CtaBand
            variant="gradient"
            title="Start with the assessment, not the prescription"
            description="Create a free account, record where you are starting from, and a doctor will tell you whether this is the right route for you — including if the answer is no."
            primaryLabel="Create a free account"
            secondaryHref={MARKETING_ROUTES.pricing}
            secondaryLabel="See all prices"
          />
        </div>
      </Section>
    </>
  );
}
