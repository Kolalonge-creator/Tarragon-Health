import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, BlockHeading } from "../_components/page-hero";
import { Section } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { ExamplePhone } from "../_components/home-example-screens";
import { SAFETY_STATEMENT } from "../_content/pricing-ladder";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { paidProductName } from "@/lib/marketing/membership";

export const metadata: Metadata = pageMetadata({
  title: "How it works",
  description:
    "From your first health profile to a plan made for you, laboratory results reviewed by a doctor, and follow-up all year. Step by step, in plain English.",
  path: MARKETING_ROUTES.howItWorks,
});

/**
 * How it works, website upgrade Phase 2 (2026-11-05, plan section 7.1). The
 * whole journey from sign-up to ongoing care, with each step marked Free or
 * Membership so nobody reads a Membership feature as free. No turnaround time
 * is promised anywhere (the founder brief: do not advertise one until staffing
 * proves it); /accountability shows the live, signed commitments instead.
 */
type Step = { title: string; body: string; plan: "Free" | "Membership" | "Every plan" };

function steps(member: string): Step[] {
  return [
    {
      title: "Create your account",
      body: "Sign up on the web or your phone in a few minutes. No card is needed, and the account is yours to keep.",
      plan: "Every plan",
    },
    {
      title: "Build your health profile",
      body: "Answer a short assessment: your age, conditions, medicines, family history and lifestyle, and any recent readings such as blood pressure and weight.",
      plan: "Every plan",
    },
    {
      title: "Get a preventive plan made for you",
      body: "Your plan comes from care protocols our Chief Medical Officer signs. It recommends the tests and checks that fit your age, sex, history and family history, rather than one panel for everyone.",
      plan: "Membership",
    },
    {
      title: "Download your request form",
      body: "Each recommended test comes with a laboratory request form in the app, ready to show at the laboratory.",
      plan: "Membership",
    },
    {
      title: "Do the test at a laboratory you choose",
      body: "Take the form to any reputable laboratory you choose. You pay the laboratory directly; contact the laboratory for current pricing.",
      plan: "Every plan",
    },
    {
      title: "Upload the report",
      body: "Take a photo of the report or upload the PDF. Software reads the values into your record, anything unclear is checked by a person, and a doctor reviews the result.",
      plan: "Membership",
    },
    {
      title: "Understand what it means",
      body: "You get a plain-English explanation and a clear next step. If a result needs action, your care team follows it up with you.",
      plan: "Membership",
    },
    {
      title: "Keep going all year",
      body: `${member} includes one online meeting with a doctor each month, written questions between calls, prescriptions you can take to any pharmacy, and reminders when a test or check is due.`,
      plan: "Membership",
    },
    {
      title: "Watch your health over time",
      body: "Every reading and result builds one record, so you and your doctor can see trends, not just single numbers.",
      plan: "Every plan",
    },
  ];
}

const FAQ = [
  {
    question: "Do I have to use a particular laboratory?",
    answer: "No. Your request form works at any reputable laboratory. You pay the laboratory directly, and you can find laboratories near you in our directory.",
  },
  {
    question: "Who reviews my results?",
    answer:
      "On Membership, a doctor on our care team reviews every report you upload. Software helps by reading the values off the report, but a doctor makes the clinical decision. When a doctor has reviewed something, the app shows their name.",
  },
  {
    question: "What if my result is worrying?",
    answer: `${SAFETY_STATEMENT} If something needs urgent care, we tell you to go to a hospital straight away rather than wait for a message from us.`,
  },
  {
    question: "Can someone in my family follow my care?",
    answer:
      "Yes, if you choose. With Care Circle you decide who can see which parts of your care, and you can pause or stop sharing at any time.",
  },
  {
    question: "Do I need a smartphone?",
    answer: "No. Tarragon works in any web browser, on a phone or a computer.",
  },
];

export default function HowItWorksPage() {
  const member = paidProductName();
  const list = steps(member);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }} />
      <PageHero
        eyebrow="How it works"
        title="One connected way to look after your health."
        description="Tarragon joins up the parts of your health that usually live apart: your profile, a plan made for you, your laboratory results, a doctor's review of them and follow-up through the year."
        primary={{ href: "/signup", label: "Get started" }}
        secondary={{ href: MARKETING_ROUTES.membership, label: `See what ${member} includes` }}
      />

      <Section variant="sage" labelledBy="hiw-steps-title">
        <BlockHeading
          id="hiw-steps-title"
          eyebrow="Step by step"
          title="From your first visit to a year of care."
          description={`Steps marked ${member} are part of ${member}. Everything else is free.`}
        />
        <ol className="grid gap-3">
          {list.map((step, i) => (
            <li key={step.title} className="grid gap-2 rounded-2xl bg-white p-5 sm:grid-cols-[4rem_1fr_auto] sm:items-start sm:gap-6 sm:p-6">
              <span className="font-heading text-3xl text-brand-green" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="grid gap-1">
                <span className="text-lg font-semibold text-charcoal-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </span>
                <span className="text-mk-muted">{step.body}</span>
              </span>
              <span
                className={`justify-self-start rounded-full px-3 py-1 text-xs font-semibold ${
                  step.plan === "Membership" ? "bg-brand-green text-white" : "bg-soft-sage text-brand-green"
                }`}
              >
                {step.plan === "Membership" ? member : step.plan}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section labelledBy="hiw-app-title">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <BlockHeading
              id="hiw-app-title"
              eyebrow="Your record"
              title="Each result adds to the picture."
              description="A single result tells you about one day. Results over time show whether something is changing, which is what a doctor needs to act early."
            />
            <p className="text-charcoal-ink/80">
              Want to know how we choose tests and review results?{" "}
              <Link href={MARKETING_ROUTES.clinicalApproach} className="inline-block py-1 font-semibold text-brand-green hover:underline">
                Read our clinical approach
              </Link>
            </p>
          </div>
          <div className="flex justify-center">
            <ExamplePhone screen="trend" className="w-full max-w-[260px]" />
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <BlockHeading id="hiw-faq-title" eyebrow="Questions" title="Common questions" />
        <FaqAccordion items={FAQ} variant="minimal" />
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Start with a free account."
          description={`Add ${member} when you want a doctor working with you all year.`}
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.membership}
          secondaryLabel={`Explore ${member}`}
        />
      </Section>
    </>
  );
}
