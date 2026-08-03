import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Give the Gift of Health",
  description:
    "Buy a parent or family member a named health check they can use whenever suits them. Not a balance, not a gift card, a real appointment already paid for.",
  alternates: { canonical: MARKETING_ROUTES.gift },
};

const WAYS_TO_GIVE = [
  {
    title: "Pay for their plan",
    body: "For a parent, spouse, or family member already linked to you on Tarragon: put their plan on your card. They get their screening schedule worked out for them and a doctor reading every result that comes back, and it renews from your card rather than theirs. Their results go to them and their doctor, never to you.",
  },
  {
    title: "Invite them, you both get a reward",
    body: "If they are not on Tarragon yet, share your personal referral link. Signing up is free. Once they complete their first paid order, you both receive a ₦500 reward voucher toward your care. It is a discount, not cash, and it cannot be exchanged for money.",
  },
];

const GIFT_IDEAS = [
  {
    title: "A year of Complete Care",
    price: "Their plan, on your card",
    body: "Doctor review of their readings, their whole screening schedule worked out for them, and someone reading every result that comes back. You pay for the plan; they pay their own laboratory when they go, at that lab's price. Results go to them and their doctor, never to you.",
  },
  {
    title: "Top up what a test will cost",
    price: "Any amount",
    body: "Tests are paid straight to the laboratory, so the practical gift is covering it. Put money toward their care and they use it when they go, without having to ask you first.",
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
    title: "They go whenever suits them",
    body: "We tell them which tests are due and write the request. They take it to any laboratory they like and pay there, and a doctor reads whatever comes back.",
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
            Buy someone a real health check, already paid for, waiting on their account until they
            are ready. Not a balance to manage, not a gift card to lose. A specific appointment
            with their name on it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/login">Pay for someone’s plan</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/signup">New here? Get started</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Already a member? Open the people you support on your dashboard to pay for their plan,
            or share your referral link.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Two ways to give"
          title="A named check, not a balance"
          description="You are buying a service, not topping up an account. That is a real difference, and it is the one that makes the gift worth something."
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
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            Honest expectations
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            You can pay for the plan of someone already connected to you on Tarragon, a next of kin
            or a family member you look after. What you cannot do is pay for their tests through us:
            laboratories are paid directly, by whoever is standing in one, so the practical way to
            help with a test is to send them what it costs. If the person you want to give to is not
            on Tarragon yet, use your referral link instead. It is free for them to join, and you
            both get a ₦500 reward voucher the moment they complete their first paid order.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            A reward voucher is for the person named on it. It cannot be transferred, and it is
            never exchangeable for cash. You will be told when a plan you pay for renews, and
            nothing about their results.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Looking after a parent day to day?{" "}
            <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green hover:underline">
              Caring for a parent
            </Link>{" "}
            is the year-round version of this: they keep their own account and name you as next of
            kin, so you can follow their care and we call you first if something urgent comes up,
            rather than it being a one-off gift.
          </p>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Give someone the gift of being looked after."
          description="Pay for their plan, or send them your referral link. Either way it is care, not a card that expires."
          primaryHref="/login"
          primaryLabel="Pay for someone’s plan"
          secondaryHref="/signup"
          secondaryLabel="Get started"
        />
      </Section>
    </>
  );
}
