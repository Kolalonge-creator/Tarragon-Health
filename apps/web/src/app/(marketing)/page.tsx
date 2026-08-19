import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContinuityPath } from "./_components/continuity-path";
import { CtaBand } from "./_components/cta-band";
import { MarketingHero } from "./_components/marketing-hero";
import { MarketingMediaFrame } from "./_components/marketing-media-frame";
import { MarketingVideo } from "./_components/marketing-video";
import { Section, SectionHeading } from "./_components/section";
import { StoryPanel } from "./_components/story-panel";
import { TestimonialsSection } from "./_components/testimonials-section";
import { AppDashboardMockup } from "./_components/app-dashboard-mockup";
import { EmergencyNotice } from "./_components/emergency-notice";
import { TrustBand } from "./_components/trust-band";
import { MARKETING_MEDIA } from "./_content/media";
import { AnimatedNumber } from "./_components/animated-number";
import { StepsExplorer } from "./_components/steps-explorer";
import { HOW_IT_WORKS_STEPS, PREVENTION_CALLOUT, PROOF_STATS, SERVICE_CARDS } from "./_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "TarragonHealth | Care that stays with you",
  description:
    "Health monitoring for chronic disease, preventive health, and care coordination. Track vitals, medication, labs, and preventive checks in one secure platform.",
  path: "/",
});

export default function MarketingHomePage() {
  const { homepage } = MARKETING_MEDIA;
  const { walkthroughVideo } = homepage;

  return (
    <>
      <Section className="relative overflow-hidden pt-16 sm:pt-24">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-brand-green/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-10 -z-10 h-[320px] w-[320px] rounded-full bg-sprout-gold/15 blur-3xl"
        />
        {/* No custom visual override: the default MarketingMediaFrame renders
            homepage.hero (ambient video once videoSrc is set, otherwise the
            calm illustration), the same framed-card treatment used for every
            other image on the site. */}
        <MarketingHero media={homepage.hero}>
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Continuity, not just monitoring
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl lg:text-6xl">
            Care that stays with you.
          </h1>
          <p className="mt-4 font-heading text-xl text-charcoal-ink/80 sm:text-2xl">
            Health monitoring for chronic disease, prevention, and care coordination.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Track blood pressure, blood sugar, weight, medication, lab checks, and preventive
            health needs in one secure platform, with clinical review and escalation when closer
            care is needed. And if you&apos;re healthy? Screenings, vaccinations, and yearly checks
            that keep you that way.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Button asChild size="lg">
              <Link href="/signup">Get started</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.services}>See how it works</Link>
            </Button>
          </div>
        </MarketingHero>
        <ContinuityPath />
      </Section>

      <Section className="py-8 sm:py-10">
        <div className="grid gap-4 rounded-2xl border border-charcoal-ink/10 bg-white p-4 shadow-sm sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          {PROOF_STATS.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl bg-warm-ivory p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            >
              <p className="font-heading text-3xl font-bold text-brand-green">
                <AnimatedNumber value={stat.value} />
              </p>
              <h2 className="mt-1 font-heading text-sm font-semibold uppercase tracking-wide text-charcoal-ink">
                {stat.label}
              </h2>
              <p className="mt-2 text-sm text-charcoal-ink/65">{stat.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Two front doors, the same shared record, entered from either side.
          Healthy visitors must see themselves within the first screen-and-a-
          half, not at section six (prevention-first repositioning). */}
      <Section>
        <SectionHeading
          eyebrow="Start where you are"
          title="Two ways in, one record"
          description="Tarragon is for people managing a condition, and just as much for people who don't have one and intend to keep it that way."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          <Link
            href={MARKETING_ROUTES.prevention}
            className="group rounded-2xl border border-brand-green/25 bg-white p-8 transition-colors hover:border-brand-green/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
          >
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              I&apos;m healthy
            </p>
            <h3 className="mt-2 font-heading text-xl font-semibold text-charcoal-ink group-hover:text-brand-green">
              Stay that way →
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
              A screening and vaccination calendar built for your age and history, a yearly
              health check, and education that makes sense of your numbers. Prevention that
              actually gets done.
            </p>
          </Link>
          <Link
            href={MARKETING_ROUTES.chronicCare}
            className="group rounded-2xl border border-charcoal-ink/10 bg-white p-8 transition-colors hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
          >
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              I&apos;m managing a condition
            </p>
            <h3 className="mt-2 font-heading text-xl font-semibold text-charcoal-ink group-hover:text-brand-green">
              Get followed up properly →
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
              Hypertension, diabetes, weight: monitored between visits, reviewed against care
              protocols, and escalated to a doctor when something needs attention.
            </p>
          </Link>
        </div>
      </Section>

      <Section variant="sage">
        <StoryPanel
          eyebrow="The problem"
          title="Chronic disease is poorly followed up between doctor visits"
          description="Families worry because readings drift, medication gets missed, and preventive checks slip, with no one watching consistently in between. And for healthy people, the screenings and vaccinations that would catch problems early rarely happen at all, until something is missed."
          media={homepage.problem}
        />
      </Section>

      {/* The spec's numbered "how it works" sequence (§3.1.5), reusing the
          exact HOW_IT_WORKS_STEPS/StepsExplorer pair already built for
          /services rather than a duplicate list — this is the one place on
          the homepage where a real sequence justifies numbering. */}
      <Section>
        <SectionHeading
          eyebrow="How it works"
          title="Tarragon monitors, reminds, reviews, coordinates, and escalates"
          description="Your care team keeps watch over your health record: calm follow-up when things are steady, escalation when they are not."
        />
        <div className="mx-auto grid max-w-5xl items-start gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <StepsExplorer
            steps={HOW_IT_WORKS_STEPS.map(({ title, body }) => ({ title, body }))}
            tone="green"
          />
          <MarketingMediaFrame
            media={{
              illustration: "connected-care",
              imageAlt: "Readings, reminders, and doctor review in one connected record",
            }}
          />
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link href={MARKETING_ROUTES.services}>See the full walkthrough</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={MARKETING_ROUTES.about}>About Tarragon</Link>
          </Button>
        </div>
      </Section>

      <Section className="py-10 sm:py-14">
        <SectionHeading
          eyebrow="Chronic care programmes"
          title="Hypertension, diabetes, and weight, managed with follow-up"
          description="Three conditions drive most preventable emergencies in Nigeria. Tarragon runs a structured, doctor-reviewed programme for each, on one shared record, so related conditions are watched together, not separately."
        />
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3">
          {SERVICE_CARDS.filter((card) =>
            ["hypertension", "diabetes", "obesity"].includes(card.key)
          ).map((service) => (
            <Link
              key={service.key}
              href={service.href}
              className="group rounded-full border border-charcoal-ink/10 bg-white px-5 py-2.5 text-sm font-medium text-charcoal-ink transition-colors hover:border-brand-green/40 hover:text-brand-green"
            >
              {service.title}
              <span
                aria-hidden
                className="ml-1.5 inline-block transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-center">
          <Link
            href={MARKETING_ROUTES.chronicCare}
            className="text-sm font-medium text-deep-forest hover:underline"
          >
            How chronic care works at Tarragon →
          </Link>
        </p>
      </Section>

      <Section variant="sage">
        <MarketingVideo
          youtubeId={walkthroughVideo.youtubeId}
          title={walkthroughVideo.title}
          caption={walkthroughVideo.caption}
          poster={walkthroughVideo.poster}
        />
      </Section>

      <Section>
        <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-brand-green/20 bg-white shadow-sm lg:grid-cols-[0.9fr_1.1fr]">
          <MarketingMediaFrame
            media={{ illustration: "prevention", imageAlt: "Preventive health and screening follow-up" }}
            className="rounded-none border-0 shadow-none lg:min-h-full"
          />
          <div className="p-8 sm:p-10">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Priority programme
            </p>
            <h2 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink sm:text-3xl">
              {PREVENTION_CALLOUT.title}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              {PREVENTION_CALLOUT.body}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href={MARKETING_ROUTES.prevention}>Learn about preventive health</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href={MARKETING_ROUTES.annualHealthCheck}>The Annual Health Check →</Link>
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section>
        <div className="mx-auto grid max-w-5xl items-center gap-8 overflow-hidden rounded-2xl border border-brand-green/20 bg-white p-8 shadow-sm sm:p-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12 lg:p-12">
          <AppDashboardMockup className="relative mx-auto" />
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              On your phone
            </p>
            <h2 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink sm:text-3xl">
              Take Tarragon with you
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Add TarragonHealth to your phone&apos;s home screen and check in wherever you are.
              No app store, no separate download, the same secure record you already use on the
              web.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                "Track BP, glucose, and weight trends at a glance",
                "Get reminders for medication, screenings, and reviews",
                "Message your care team any time, right in the app",
                "Share your Health Passport with any doctor",
                "Automatic sync from Apple Health, Health Connect, and wearables, rolling out device by device",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-charcoal-ink/75">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">Get started</Link>
              </Button>
            </div>
            <p className="mt-3 text-sm text-charcoal-ink/55">
              Already have an account? Open tarragonhealth.ng on your phone, then tap Share →
              Add to Home Screen on iPhone, or Install app when Chrome prompts you on Android.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Explore"
          title="Find the care that fits you"
          description="Whether you're managing a condition, staying ahead of one, or looking after someone else, there's a place to start."
        />
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              href: MARKETING_ROUTES.prevention,
              title: "Prevention",
              body: "Healthy and staying that way: screenings, vaccines, yearly checks.",
            },
            {
              href: MARKETING_ROUTES.services,
              title: "Services",
              body: "Everything Tarragon helps you manage, and how it fits together.",
            },
            {
              href: MARKETING_ROUTES.whoItsFor,
              title: "Who it's for",
              body: "For you, for families, for employers, and for HMOs.",
            },
            {
              href: MARKETING_ROUTES.pricing,
              title: "Pricing",
              body: "Clear plans with no hidden costs. See what's included.",
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-xl border border-charcoal-ink/10 bg-white p-6 transition-colors hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink group-hover:text-brand-green">
                {item.title}
                <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section variant="navy">
        <SectionHeading
          eyebrow="Why people trust Tarragon"
          title="Built to be accountable to you"
          invert
        />
        <TrustBand />
      </Section>

      <TestimonialsSection />

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Care that stays with you."
          description="Get started today, for yourself or someone you love."
          primaryHref="/signup"
          primaryLabel="Get started"
        />
      </Section>
    </>
  );
}
