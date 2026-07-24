import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Health Education",
  description:
    "Learning built around your own conditions and risk, reviewed by our clinical team, with short knowledge checks so you can see what's actually sticking.",
  alternates: { canonical: MARKETING_ROUTES.healthEducation },
};

const WHATS_INCLUDED = [
  {
    title: "Built around you, not a general library",
    body: "What you see is matched to your own conditions and risk level: a person managing hypertension and a healthy person preparing for a screening see different things.",
  },
  {
    title: "Reviewed by our clinical team",
    body: "Every piece is checked for accuracy before it's published: no generic internet health advice, and nothing that contradicts what your own doctor tells you.",
  },
  {
    title: "Short knowledge checks",
    body: "A quick check after each topic shows you, honestly, whether it landed; not a quiz to pass, just a mirror.",
  },
  {
    title: "Marks what still needs another look",
    body: "Understand something? It moves aside. Not sure? It stays near the top until it clicks: your own pace, not a fixed course.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "We look at your record",
    body: "Your active conditions and risk level (from your health profile or a recent screening) decide what's relevant to you right now.",
  },
  {
    step: 2,
    title: "You get a short, focused list",
    body: "A handful of topics, not a library to get lost in, ranked so what needs your attention most comes first.",
  },
  {
    step: 3,
    title: "Read it, check yourself, move on",
    body: "Each topic takes a few minutes. An optional knowledge check tells you plainly what stuck and what to revisit.",
  },
  {
    step: 4,
    title: "It keeps up as your care changes",
    body: "New condition, new result, new risk level: your list updates with it, so it's never stale advice from months ago.",
  },
];

export default function HealthEducationPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Understand your own numbers
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Health education, built for you specifically
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Not a general health blog. A short, personalised list of what&apos;s actually relevant
            to your own conditions and risk, reviewed by our clinical team, with a quick check to
            show you what&apos;s sticking.
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
            Included on Complete Care and above; available as a ₦5,000/month add-on on Essential
            Care or Tarragon Free.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What's included"
          title="Made to fit your record, not a generic library"
        />
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
        <SectionHeading eyebrow="How it works" title="A loop, not a course" />
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
            For anyone in your record, condition or none
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Managing hypertension, diabetes, or your weight? You&apos;ll see the practical detail
            that turns a reading into an understanding: why a target matters, what a trend means,
            what to watch for. Healthy and using{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green hover:underline">
              Tarragon Prevent
            </Link>
            ? You&apos;ll see what your screenings and vaccinations are actually for, so a clear
            result means something and not just a form filled in.
          </p>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Understand your health, not just track it."
          description="Personalised, clinically reviewed, and updated as your care changes."
          primaryHref="/signup"
          primaryLabel="Start learning"
        />
      </Section>
    </>
  );
}
