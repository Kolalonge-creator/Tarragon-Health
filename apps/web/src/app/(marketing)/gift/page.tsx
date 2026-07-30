import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Give the Gift of Health",
  description:
    "Fund a parent or family member's Health Wallet, or invite them with your referral link, both grow the same balance they can spend on any Tarragon lab test, health check, or pharmacy order.",
  alternates: { canonical: MARKETING_ROUTES.gift },
};

const WAYS_TO_GIVE = [
  {
    title: "Fund their Health Wallet",
    body: "For a parent, spouse, or family member you already look after on Tarragon: top up their Health Wallet directly from your own dashboard. It's one NGN balance they can spend, at their own pace, on any lab test, Annual Health Check, pharmacy order, or referral fee. It never expires and is never cashed out, so nothing goes to waste.",
  },
  {
    title: "Invite them, you both get credit",
    body: "If they're not on Tarragon yet, share your personal referral link. Signing up is free. Once they complete their first paid order, you both receive ₦500 in Health Wallet credit, a small gift built into every invite, not just a one-way favour.",
  },
];

const GIFT_IDEAS = [
  {
    title: "An Annual Health Check",
    price: "₦65,000",
    body: "Blood sugar, cholesterol, blood pressure, BMI, and the cancer screening that fits their age and sex, all reviewed by a doctor. Top up their wallet by this amount and they can book it whenever suits them.",
  },
  {
    title: "A year of Tarragon Prevent",
    price: "₦35,000/year",
    body: "The stay-healthy plan: a personal screening and vaccination calendar, booked automatically, with a doctor stepping in the same day if anything ever needs attention.",
  },
  {
    title: "Just a top-up",
    price: "Any amount",
    body: "Let them decide what they need most. Whatever you add sits in their wallet until they're ready to spend it.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Add them as family",
    body: "If they're not already linked to you, add them as a next of kin or family member from your Family page, one time, and the connection carries a consent grant.",
  },
  {
    step: 2,
    title: "Open your Health Wallet",
    body: "From your dashboard, choose Top up and select who you're funding: yourself, or someone you look after.",
  },
  {
    step: 3,
    title: "Pay, and it's in their balance",
    body: "The amount lands straight in their Health Wallet. No gift card, no code to lose, nothing to redeem.",
  },
  {
    step: 4,
    title: "They spend it whenever",
    body: "On any lab test, health check, pharmacy order, or referral fee, at their own pace, on their own record.",
  },
];

export default function GiftPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Care that stays with them
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Give the Gift of Health
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Fund a parent or loved one&apos;s Health Wallet, or invite them with your referral
            link. Either way, the credit lands in one balance they can spend on real care: lab
            tests, health checks, medication, and more, whenever they need it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/login">Fund a loved one&apos;s wallet</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/signup">New here? Get started</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Already a member? Open the Health Wallet card on your dashboard to top up or share
            your referral link.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Two ways to give"
          title="The Health Wallet is the mechanism"
          description="One NGN balance, fed from more than one direction, spent only on Tarragon care, never cashed out."
        />
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
          {WAYS_TO_GIVE.map((item) => (
            <div key={item.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Ideas" title="What to gift" />
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-3">
          {GIFT_IDEAS.map((item) => (
            <div key={item.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-1 font-heading text-xl font-bold text-brand-green">{item.price}</p>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How it works" title="No gift cards, no codes to lose" />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <p className="font-heading text-2xl font-bold text-brand-green">{item.step}</p>
              <h3 className="mt-2 font-heading text-base font-semibold text-charcoal-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            Honest expectations
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Wallet funding works today for people already connected to you on Tarragon, a next
            of kin or a family member you look after. If the person you want to give to isn&apos;t
            on Tarragon yet, use your referral link instead: it&apos;s free for them to join, and
            you both get ₦500 in wallet credit the moment they complete their first paid order.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Looking after a parent day to day? <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green hover:underline">ParentCare</Link> is
            the year-round version of this, a dedicated care coordinator and shared visibility
            into their care, not just a wallet top-up.
          </p>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Give someone the gift of being looked after."
          description="Fund their Health Wallet, or send them your referral link. Either way, it's real care, not a card that expires."
          primaryHref="/login"
          primaryLabel="Fund a loved one's wallet"
          secondaryHref="/signup"
          secondaryLabel="Get started"
        />
      </Section>
    </>
  );
}
