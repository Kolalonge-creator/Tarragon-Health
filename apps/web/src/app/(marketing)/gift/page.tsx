import type { Metadata } from "next";
import Link from "next/link";
import { formatNaira } from "@tarragon/commerce";
import { getProposedConfig } from "@tarragon/shared";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion, type FaqItem } from "../_components/marketing-faq-accordion";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { PhotoBannerHero } from "../_components/marketing-photo-banner-hero";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_MEDIA } from "../_content/media";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { GiftPersonalizer } from "./_components/gift-personalizer";

export const metadata: Metadata = pageMetadata({
  title: "Give the Gift of Health",
  description:
    "Give a parent or family member a year of Membership: a yearly blood test and a monthly video call with their care team, paid for by you and theirs to accept.",
  path: MARKETING_ROUTES.gift,
});

export const revalidate = 3600;

/** The Membership price, read from the versioned config (integer kobo), never typed into a page. */
function membershipPrice(): string {
  const v = getProposedConfig("commerce.membership_prices").value as { individual_kobo: number };
  return formatNaira(v.individual_kobo);
}

const WAYS_TO_GIVE = [
  {
    title: "Give them a year of Membership",
    body: "For a parent, spouse or family member: a yearly blood test, a video call with their care team every month, written questions between calls and prescriptions their care team signs. You pay once, in naira, wherever you are paying from. It does not renew by itself.",
  },
  {
    title: "They choose to accept it",
    body: "The gift waits for them to accept it. If they decline, or do not answer in time, you are refunded. Nothing about a gift ever bills them, then or later.",
  },
  {
    title: "Invite them, you both get a reward",
    body: "If they are not on Tarragon yet, share your personal referral link; signing up is free. Once they become a Member, you both get a reward voucher, a discount, not cash.",
  },
];

function giftFaq(price: string): FaqItem[] {
  return [
    {
      question: "What exactly am I giving?",
      answer: `A year of Membership, ₦${price}. It is the same Membership anyone can join: a yearly blood test, a video call with their care team every month, written questions between calls and prescriptions their care team signs. Medicines are not included.`,
    },
    {
      question: "Who can I give it to?",
      answer:
        "A parent, spouse, sibling or child. If they already use Tarragon, link them as family or next of kin first, from your dashboard's Your people page. If they have not used Tarragon before, you can set up a record for them yourself with their name, phone number and your relationship to them. They do not need a smartphone or an account of their own for this to work.",
    },
    {
      question: "Will I see their results?",
      answer:
        "No. Results go to them and their care team, and to nobody else. You are only told when the gift has been accepted.",
    },
    {
      question: "What if they say no, or do not answer?",
      answer: "You are refunded. The gift is theirs to accept, and it waits for their answer.",
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
    title: "Tell us who it's for",
    body: "If they already use Tarragon, link them as family or next of kin first. If they don't, set up their record yourself: they don't sign up or do anything before you can pay.",
  },
  {
    step: 2,
    title: "Choose Membership",
    body: "From Buy care for someone on your dashboard, choose the yearly Membership. The price is shown before you pay.",
  },
  {
    step: 3,
    title: "Pay once",
    body: "Pay by card, bank transfer or USSD. There is nothing to cancel and it does not renew by itself.",
  },
  {
    step: 4,
    title: "They accept it",
    body: "The gift waits on their account for their answer. When they accept, their Membership starts.",
  },
];

export default function GiftPage() {
  const price = membershipPrice();
  const faq = giftFaq(price);
  return (
    <>
      {/* Rendered outside Section on purpose — full-bleed spans the full
          viewport width; see marketing-photo-banner-hero.tsx's header comment. */}
      <PhotoBannerHero
        eyebrow="Care that stays with them"
        title="Give the Gift of Health"
        description={`Give someone a year of Membership, ₦${price}: a yearly blood test and a video call with their care team every month. Theirs to accept, nothing to renew.`}
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
              You are giving a Membership, not topping up an account, and that difference is what makes the gift worth something.
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
        <SectionHeading eyebrow="How it works" title="No gift cards, no codes to lose" />
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
        <SectionHeading eyebrow="Before you give" title="Honest expectations" />
        <FaqAccordion items={faq} />
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          Looking after a parent day to day?{" "}
          <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            Caring for a parent
          </Link>{" "}
          is the year-round version of this: they keep their own account and name you as next of kin, so you can follow their care and we call you first if something urgent comes up.
        </p>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Give someone the gift of being looked after."
          description="Give a year of Membership, or send them your referral link. Either way it is care, not a card that expires."
          primaryHref="/signup?intent=support"
          primaryLabel="Give a year of Membership"
          secondaryHref="/login"
          secondaryLabel="Already a member? Sign in"
        />
      </Section>
    </>
  );
}
