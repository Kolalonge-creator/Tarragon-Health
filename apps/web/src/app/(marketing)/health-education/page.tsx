import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Health Education",
  description:
    "Free learning built around your own conditions and risk, with clinically reviewed content clearly marked and short checks so you see what is sticking.",
  path: MARKETING_ROUTES.healthEducation,
});

const WHATS_INCLUDED = [
  {
    title: "Matched to you, not a general library",
    body: "What you see is matched to your own conditions and risk level. A person managing hypertension and a healthy person preparing for a screening see different topics.",
  },
  {
    title: "Clearly marked clinical review",
    body: "Content that our clinical team has reviewed carries a visible mark, so you always know which pieces have had that extra check. It is not generic internet health advice, and it is not meant to contradict what your own doctor tells you.",
  },
  {
    title: "Short knowledge checks",
    body: "A short check after each topic shows you how much you have understood. It is not a test to pass, only a way to see what you have retained.",
  },
  {
    title: "Shows what still needs another look",
    body: "If you understand a topic, it moves aside. If you are not sure, it stays near the top until you do. You learn at your own pace and do not follow a fixed course.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "We look at your record",
    body: "Your current conditions and risk level, taken from your health profile or a recent screening, determine which topics are relevant to you now.",
  },
  {
    step: 2,
    title: "You receive a short, focused list",
    body: "You see a small number of topics instead of a large library, ordered so that what needs your attention most comes first.",
  },
  {
    step: 3,
    title: "Read, check your understanding, move on",
    body: "Each topic takes a few minutes. An optional knowledge check shows you what you have understood and what to revisit.",
  },
  {
    step: 4,
    title: "It changes as your care changes",
    body: "If you have a new condition, a new result or a new risk level, your list updates with it, so the advice stays current.",
  },
];

export default function HealthEducationPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Understand your own readings
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Health education matched to you
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            This is not a general health blog. It is a short, personalised list of what is relevant
            to your own conditions and risk, with clinically reviewed content clearly marked and a
            short check to show you what you have understood.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Start learning</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.pricing}>View pricing</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Personalised to your own conditions and risk, and free, like the rest of the library.
            No payment card is needed and there is no time limit.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              What&apos;s included
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Matched to your record, not a generic library
            </h2>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "personalized-learning",
              imageAlt: "Learning content matched to your own record, not a generic library",
            }}
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {WHATS_INCLUDED.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="How it works" title="A continuing cycle, not a fixed course" />
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

      <Section variant="sage">
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            For anyone, with or without a condition
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            If you are managing hypertension, diabetes or your weight, you will see the practical detail
            that helps you understand a reading: why a target matters, what a trend means and
            what to watch for. If you are healthy and using{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              your screening calendar
            </Link>
            , you will see what your screenings and vaccinations are for, so that a normal
            result is meaningful to you and not just a completed form.
          </p>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8 text-center">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            Health is not only physical
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            If you would like to know how you are doing beyond your readings, try the free, anonymous{" "}
            <Link href={MARKETING_ROUTES.mentalWellbeingCheck} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              Mental Well-being Check
            </Link>
            . It takes two minutes, has ten questions, and needs no sign-up.
          </p>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Understand your health, not only record it"
          description="Personalised, clear about what has been clinically reviewed, and updated as your care changes."
          primaryHref="/signup"
          primaryLabel="Start learning"
        />
      </Section>
    </>
  );
}
