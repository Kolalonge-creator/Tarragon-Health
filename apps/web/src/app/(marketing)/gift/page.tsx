import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion, type FaqItem } from "../_components/marketing-faq-accordion";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { PhotoBannerHero } from "../_components/marketing-photo-banner-hero";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_MEDIA } from "../_content/media";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { membershipPriceLabel, paidProductName } from "@/lib/marketing/membership";
import { GiftPersonalizer } from "./_components/gift-personalizer";

export const metadata: Metadata = pageMetadata({
  title: "Give the gift of health",
  description:
    "Give a parent or family member a year of Membership: a monthly online meeting with a doctor from their care team, paid once by you and theirs to accept.",
  path: MARKETING_ROUTES.gift,
});

export const revalidate = 3600;

/** What is being given, in words: one yearly gift, the Membership (T2-01, 2026-11-04), priced from versioned config. */
function givingSummary(price: string): string {
  return `A year of ${paidProductName()}, ₦${price}`;
}

const WAYS_TO_GIVE = [
  {
    title: "Give them a year of Membership",
    body: "For a parent, spouse or family member: a personalised preventive plan, one online meeting with a doctor from their care team every month, and a doctor's review of the laboratory reports they upload. Laboratory tests are paid to the laboratory directly. You pay once, in naira, wherever you are paying from. It does not renew by itself.",
  },
  {
    title: "They choose to accept it",
    body: "The gift waits for them to say yes. If they decline, or do not answer within 14 days, we will refund you. A gift never results in a charge to them, now or later.",
  },
  {
    title: "Invite them to join Tarragon",
    body: "If they are not on Tarragon yet, share your personal referral link; signing up is free. If they become a Member, we will say thank you.",
  },
];

function giftFaq(price: string): FaqItem[] {
  return [
    {
      question: "What exactly am I giving?",
      answer: `${givingSummary(price)}. It is the same Membership anyone can join: a personalised preventive plan and test schedule, laboratory request forms to take to any reputable laboratory, a doctor's review of the reports they upload, and one online meeting with a doctor from their care team every month. Laboratory tests and medicines are not included; they pay the laboratory or pharmacy directly.`,
    },
    {
      question: "Who can I give it to?",
      answer:
        "A parent, spouse, sibling or child. After you pay, a member of our team phones them to say hello and help them start. They say yes in their own words; nothing begins before that.",
    },
    {
      question: "Will I see their results?",
      answer:
        "No. You see only where the gift stands: waiting, accepted, declined, or not answered. Nothing about their health. Results go to them and their care team, and to nobody else.",
    },
    {
      question: "What if they say no, or do not answer?",
      answer: "We will refund you. The gift is theirs to accept, and it waits 14 days for their answer. If they say no you see \"declined\", and if they have not answered you see \"not answered\". You do not see why.",
    },
    {
      question: "What if I am buying from outside Nigeria?",
      answer: "That is fine. Checkout is in naira either way, whether you are paying from within Nigeria or from abroad.",
    },
    {
      question: "What if they already have a Membership?",
      answer: "Then they do not need another one yet. The Membership page tells you before you pay.",
    },
  ];
}

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Tell us who the gift is for",
    body: "Their name, their phone number and how you know them. They do not need to sign up or do anything before you pay.",
  },
  {
    step: 2,
    title: "Choose Membership",
    body: "From Buy care for someone on your dashboard, choose the yearly Membership. The price is shown before you pay.",
  },
  {
    step: 3,
    title: "Pay once",
    body: "Pay by card or bank transfer, through Paystack. There is nothing to cancel and it does not renew by itself.",
  },
  {
    step: 4,
    title: "They say yes",
    body: "They say yes on a short call with us, or in the app. If there is no answer in 14 days, we will refund you.",
  },
];

export default function GiftPage() {
  const price = membershipPriceLabel();
  const faq = giftFaq(price);
  return (
    <>
      {/* Rendered outside Section on purpose — full-bleed spans the full
          viewport width; see marketing-photo-banner-hero.tsx's header comment. */}
      <PhotoBannerHero
        eyebrow="Care that stays with them"
        title="Give the gift of health"
        description={`Give someone a year of ${paidProductName()}, ₦${price}: their own preventive plan and one online meeting with a doctor from their care team every month. They choose whether to accept it, and it does not renew.`}
        primaryHref="/signup?intent=support"
        primaryLabel="Give a year of Membership"
        secondaryHref="/login"
        secondaryLabel="Already a member? Sign in"
        imageSrc={MARKETING_MEDIA.gift.hero.imageSrc ?? ""}
        imageAlt={MARKETING_MEDIA.gift.hero.imageAlt ?? ""}
        imagePosition={MARKETING_MEDIA.gift.hero.imageFocus}
      />

      <Section className="pb-0 pt-10 sm:pt-14">
        <p className="mx-auto max-w-3xl text-center text-sm text-charcoal-ink/60">
          Already a member? Open Buy care for someone on your dashboard to give a year of Membership, whether or not they use Tarragon yet, or share your referral link.
        </p>
      </Section>

      <Section>
        <GiftPersonalizer />
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">Ways to give</p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">A year of care, not a balance</h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              You are giving a Membership, not adding money to an account. The gift is a year of care, and it cannot be exchanged for cash.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "gift-record",
              imageAlt: "A year of Membership, given as a gift rather than a balance",
            }}
          />
        </div>
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-3">
          {WAYS_TO_GIVE.map((item) => (
            <div key={item.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How it works" title="There are no gift cards or codes to lose" />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <p className="font-heading text-2xl font-bold text-brand-green">{item.step}</p>
              <h3 className="mt-2 font-heading text-base font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Before you give" title="What to expect" />
        <FaqAccordion items={faq} />
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          Do you help look after a parent day to day?{" "}
          <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            Caring for a parent
          </Link>{" "}
          is the year-round version of this: they keep their own account and name you as next of kin, so you can follow their care and we call you first if something urgent comes up.
        </p>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Give someone a year of care."
          description="Give a year of Membership, or send them your referral link. Either way, the gift is care and not a gift card that expires."
          primaryHref="/signup?intent=support"
          primaryLabel="Give a year of Membership"
          secondaryHref="/login"
          secondaryLabel="Already a member? Sign in"
        />
      </Section>
    </>
  );
}
