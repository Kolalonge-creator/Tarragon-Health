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
import { GiftPersonalizer } from "./_components/gift-personalizer";

export const metadata: Metadata = pageMetadata({
  title: "Give the Gift of Health",
  description:
    "Buy a parent or family member a named health check they can use whenever suits them. Not a balance, not a gift card, a real appointment already paid for.",
  path: MARKETING_ROUTES.gift,
});

const WAYS_TO_GIVE = [
  {
    title: "Buy them a named health check",
    body: "For a parent, spouse, or family member already linked to you on Tarragon: buy one specific check — Core Screen, or whichever they need — at today's real price. Pay for it in one go or bit by bit, in naira, wherever you are paying from. It sits on their account, named to them, until they book it.",
  },
  {
    title: "Buy them a year of care",
    body: "The wider option: buy a year of their plan instead of one check. Pay for it in one go or bit by bit. They start the year whenever they are ready, nothing renews afterwards so there is no card of yours left on their account, and their results go to them and their doctor, never to you.",
  },
  {
    title: "Invite them, you both get a reward",
    body: "If they are not on Tarragon yet, share your personal referral link; signing up is free. Once they complete their first paid order, you both get a ₦500 reward voucher toward your care, a discount, not cash.",
  },
];

const GIFT_IDEAS = [
  {
    title: "Core Screen",
    price: "One check, paid for once",
    body: "Their once-a-year look at the things worth checking every year: liver, kidneys, blood sugar, cholesterol, urine, blood count and HIV status. A doctor reads every result with them, in writing, with a downloadable report. If they'd also like a live video consult to talk it through, that's a separate low-cost booking they can add whenever they want one.",
  },
  {
    title: "A year of Complete Care",
    price: "Bought once, theirs to start",
    body: "Doctor review of their readings, their whole screening schedule worked out for them, and someone reading every result that comes back. You pay for the plan; they pay the lab directly, at that lab's price, and results go to them and their doctor, never to you.",
  },
  {
    title: "A year of Tarragon Prevent",
    price: "The lighter option",
    body: "Their screening calendar worked out for them, reminders when something is due, and a doctor reading whatever they upload.",
  },
];

const GIFT_FAQ: FaqItem[] = [
  {
    question: "What exactly am I buying?",
    answer:
      "Either one named health check (Core Screen and others) or a year of one of our care plans, for someone specific — never a top-up balance. It sits on their account with their name on it until they choose to use it.",
  },
  {
    question: "Who can I buy this for?",
    answer:
      "Anyone already linked to you as family or next of kin on Tarragon: a parent, spouse, sibling, or child. If they are not linked yet, add them from your Family page first, or send them your referral link instead so they can join and pay their own way.",
  },
  {
    question: "Does a health check gift include a video call with a doctor?",
    answer:
      "A doctor reads every result in writing and sends a downloadable report — that part is included in every check. A live video consult is a separate, low-cost booking: your recipient can request one whenever they'd like to talk their results through, and you or they can pay for it at that point.",
  },
  {
    question: "Can I pay for their lab tests too?",
    answer:
      "For a named health check, yes — that is exactly what you are buying: Tarragon bills one real price and settles with the laboratory directly, so there is nothing further for them to pay at the lab. For a year-of-care plan, laboratories are paid directly by whoever is standing in one, at that lab's price — if you want to help with a test on that plan, the practical way is to send them what it costs.",
  },
  {
    question: "Will I see their results?",
    answer:
      "No. Results go to them and their doctor, never to you. You will only be told when something you paid for is ready to use or due to renew.",
  },
  {
    question: "What if I am buying from outside Nigeria?",
    answer:
      "That's fine — checkout is in naira either way, whether you are paying from within Nigeria or from abroad. The year still sits on their account until they are ready to start it.",
  },
  {
    question: "What if they are already a Tarragon member?",
    answer:
      "It adds a year to their existing plan instead, so a gift never bills them twice.",
  },
  {
    question: "Can I pay in instalments?",
    answer:
      "Yes. Pay the whole year at once or spread it over as many instalments as you like. Nothing expires while you are still paying.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Add them as family",
    body: "If they are not already linked to you, add them as a next of kin or family member from your Family page. It happens once, and the connection carries a consent grant.",
  },
  {
    step: 2,
    title: "Choose the check",
    body: "From your dashboard, pick the check you want them to have and who it is for. Reserving it is free.",
  },
  {
    step: 3,
    title: "Pay for it, all at once or bit by bit",
    body: "You can pay the whole amount, or spread it over as many instalments as you like. Nothing expires while you are still paying.",
  },
  {
    step: 4,
    title: "They start it whenever suits them",
    body: "The voucher sits on their account and they choose when the year begins. If they are already on a plan it adds a year to that instead, so a gift never bills them twice.",
  },
];

export default function GiftPage() {
  return (
    <>
      {/* Rendered outside Section on purpose — full-bleed spans the full
          viewport width; see marketing-photo-banner-hero.tsx's header comment. */}
      <PhotoBannerHero
        eyebrow="Care that stays with them"
        title="Give the Gift of Health"
        description="Buy someone a real health check, already paid for, waiting on their account until they are ready. Not a balance to manage, not a gift card to lose. A specific appointment with their name on it."
        primaryHref="/login"
        primaryLabel="Buy someone a health check"
        secondaryHref="/signup?intent=support"
        secondaryLabel="New here? Get started"
        imageSrc={MARKETING_MEDIA.gift.hero.imageSrc ?? ""}
        imageAlt={MARKETING_MEDIA.gift.hero.imageAlt ?? ""}
        imagePosition={MARKETING_MEDIA.gift.hero.imageFocus}
      />

      <Section className="pb-0 pt-10 sm:pt-14">
        <p className="mx-auto max-w-3xl text-center text-sm text-charcoal-ink/60">
          Already a member? Open the care vouchers card on your dashboard to buy a health check or
          a year of care for someone, or share your referral link.
        </p>
      </Section>

      <Section>
        <GiftPersonalizer />
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Ways to give
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              A named check, not a balance
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              You are buying a service, not topping up an account, and that difference is what
              makes the gift worth something.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "gift-record",
              imageAlt: "A year of care, given as a named gift rather than a balance",
            }}
          />
        </div>
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
        <div className="mx-auto grid max-w-2xl gap-6 md:grid-cols-2">
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
        <SectionHeading eyebrow="Before you buy" title="Honest expectations" />
        <FaqAccordion items={GIFT_FAQ} />
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          Looking after a parent day to day?{" "}
          <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green hover:underline">
            Caring for a parent
          </Link>{" "}
          is the year-round version of this: they keep their own account and name you as next of
          kin, so you can follow their care and we call you first if something urgent comes up.
        </p>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Give someone the gift of being looked after."
          description="Buy them a health check or a year of care, or send them your referral link. Either way it is care, not a card that expires."
          primaryHref="/login"
          primaryLabel="Buy someone a health check"
          secondaryHref="/signup?intent=support"
          secondaryLabel="Get started"
        />
      </Section>
    </>
  );
}
