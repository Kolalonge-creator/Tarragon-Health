import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChannelHero } from "./_components/channel-hero";
import { ContinuityPath } from "./_components/continuity-path";
import { CtaBand } from "./_components/cta-band";
import { PhotoBannerHero } from "./_components/marketing-photo-banner-hero";
import { MarketingMediaFrame } from "./_components/marketing-media-frame";
import { MarketingVideo } from "./_components/marketing-video";
import { Section, SectionHeading } from "./_components/section";
import { StoryPanel } from "./_components/story-panel";
import { TestimonialsSection } from "./_components/testimonials-section";
import { AppDashboardMockup } from "./_components/app-dashboard-mockup";
import { EmergencyNotice } from "./_components/emergency-notice";
import { TrustBand } from "./_components/trust-band";
import { PartnerLogoStrip } from "./_components/partner-logo-strip";
import { MARKETING_MEDIA } from "./_content/media";
import { AnimatedNumber } from "./_components/animated-number";
import { StepsExplorer } from "./_components/steps-explorer";
import { StaggeredReveal } from "./_components/staggered-reveal";
import { HOW_IT_WORKS_STEPS, PREVENTION_CALLOUT, PROOF_STATS, SERVICE_CARDS } from "./_content/services";
import { DEFAULT_HERO } from "./_content/channel-heroes";
import { PILLARS, PILLARS_SECTION_COPY } from "./_content/pillars";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

const HOME_TITLE = "TarragonHealth | Care that stays with you";

/**
 * The marketing layout sets `title.template = "%s | TarragonHealth"`, which
 * would render this page's already-branded title as
 * "TarragonHealth | Care that stays with you | TarragonHealth" (76 chars,
 * truncated in search results). `title.absolute` opts this one page out of
 * the template; every other page keeps it, because their titles are the bare
 * page name. openGraph/twitter titles are unaffected by the template, so they
 * stay as pageMetadata built them.
 */
export const metadata: Metadata = {
  ...pageMetadata({
    title: HOME_TITLE,
    description:
      "Health monitoring for chronic disease, preventive health, and care coordination. Track vitals, medication, labs, and preventive checks in one secure platform.",
    path: "/",
  }),
  title: { absolute: HOME_TITLE },
};

/**
 * ISR, not per-request rendering. The only live data on this page is the
 * testimonials block (anon key, published rows only), and an hour-stale
 * quote is fine; docs/MARKETING_SITE_SPEC.md §4 requires marketing pages to
 * be static or ISR.
 */
export const revalidate = 3600;

export default async function MarketingHomePage() {
  const { homepage } = MARKETING_MEDIA;
  const { walkthroughVideo } = homepage;

  return (
    <>
      {/* dohealth.co-style full-bleed photo hero: real photography with
          overlaid text, spanning the full viewport width (rendered outside
          Section on purpose — see the component's own header comment).
          Replaces the old text-beside-a-photo-card MarketingHero layout for
          this slot (kept for product pages with no real photo sourced yet —
          see product-page-template.tsx).

          Hero copy is channel-gated: `?channel=hmo|employer|diaspora` swaps
          the headline/CTA for that traffic source (see _content/channel-
          heroes.ts); everything below the fold is the same page for every
          visitor. An unknown or missing value falls back to the copy every
          other visitor sees. */}
      <Suspense
        fallback={
          <PhotoBannerHero
            eyebrow={DEFAULT_HERO.eyebrow}
            title={DEFAULT_HERO.title}
            description={DEFAULT_HERO.description}
            primaryHref={DEFAULT_HERO.primaryHref}
            primaryLabel={DEFAULT_HERO.primaryLabel}
            secondaryHref={DEFAULT_HERO.secondaryHref}
            secondaryLabel={DEFAULT_HERO.secondaryLabel}
            imageSrc={homepage.hero.imageSrc ?? ""}
            imageAlt={homepage.hero.imageAlt ?? ""}
            imagePosition={homepage.hero.imageFocus}
          />
        }
      >
        <ChannelHero
          imageSrc={homepage.hero.imageSrc ?? ""}
          imageAlt={homepage.hero.imageAlt ?? ""}
          imagePosition={homepage.hero.imageFocus}
        />
      </Suspense>
      <Section className="py-8 sm:py-10">
        <ContinuityPath />
        <div className="mt-10 grid gap-4 rounded-2xl border border-charcoal-ink/10 bg-white p-4 shadow-sm sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          {PROOF_STATS.map((stat) => (
            <Card
              key={stat.label}
              variant="soft"
              className="border-0 shadow-none transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            >
              <CardContent className="p-5">
                <p className="font-heading text-3xl font-bold text-brand-green">
                  <AnimatedNumber value={stat.value} />
                </p>
                {/* Deliberately not a heading. These four stat labels used to
                    be <h2>s, which put "priority programmes" / "escalation
                    levels" ahead of the page's first real section heading in
                    every outline and screen-reader heading list. */}
                <p className="mt-1 font-heading text-sm font-semibold uppercase tracking-wide text-charcoal-ink">
                  {stat.label}
                </p>
                <p className="mt-2 text-sm text-charcoal-ink/65">{stat.detail}</p>
              </CardContent>
            </Card>
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
          <Card
            asChild
            className="rounded-2xl border-brand-green/25 hover:border-brand-green/50 focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
          >
            <Link href={MARKETING_ROUTES.prevention} className="group block p-8 focus-visible:outline-none">
              <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
                I&apos;m healthy
              </p>
              <h3 className="mt-2 font-heading text-xl font-semibold text-charcoal-ink group-hover:text-brand-green">
                Stay that way <span aria-hidden>→</span>
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
                A screening and vaccination calendar built for your age and history, a yearly
                health check, and education that makes sense of your numbers. Prevention that
                actually gets done.
              </p>
            </Link>
          </Card>
          <Card
            asChild
            className="rounded-2xl hover:border-brand-green/40 focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
          >
            <Link href={MARKETING_ROUTES.chronicCare} className="group block p-8 focus-visible:outline-none">
              <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
                I&apos;m managing a condition
              </p>
              <h3 className="mt-2 font-heading text-xl font-semibold text-charcoal-ink group-hover:text-brand-green">
                Get followed up properly <span aria-hidden>→</span>
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
                Hypertension, diabetes, weight: monitored between visits, reviewed against care
                protocols, and escalated to a doctor when something needs attention.
              </p>
            </Link>
          </Card>
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
          <MarketingMediaFrame media={homepage.solution} />
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
            How chronic care works at Tarragon <span aria-hidden>→</span>
          </Link>
        </p>
      </Section>

      {/* Same rule the product pages already follow (see PRODUCT_VIDEOS in
          _content/media.ts: "empty youtubeId = section not rendered"). The
          homepage was the one exception, shipping a play button that opened a
          tap-through mockup captioned "Full video walkthrough coming soon" as
          a live section. Set walkthroughVideo.youtubeId to bring it back. */}
      {walkthroughVideo.youtubeId.trim() ? (
        <Section variant="sage">
          <MarketingVideo
            youtubeId={walkthroughVideo.youtubeId}
            title={walkthroughVideo.title}
            caption={walkthroughVideo.caption}
            poster={walkthroughVideo.poster}
          />
        </Section>
      ) : null}

      {/* The "beyond the numbers" habit framing (competitive-teardown addition,
          2026-08-20): five daily-habit areas keyed 1:1 to the Lifestyle
          Programme Engine's lpe_module enum (see _content/pillars.ts), so
          this copy never drifts from what the product actually tracks. Text
          only, no icons, matching TrustPillars' card pattern rather than
          inventing a new visual language for one section. */}
      <Section>
        <SectionHeading
          eyebrow={PILLARS_SECTION_COPY.eyebrow}
          title={PILLARS_SECTION_COPY.title}
          description={PILLARS_SECTION_COPY.description}
        />
        <StaggeredReveal className="grid gap-px overflow-hidden rounded-2xl bg-charcoal-ink/10 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.module}
              className="relative h-full bg-white p-6 transition-transform duration-300 hover:z-10 hover:-translate-y-1 hover:shadow-lg"
            >
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{pillar.body}</p>
            </div>
          ))}
        </StaggeredReveal>
      </Section>

      <Section>
        <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-brand-green/20 bg-white shadow-sm lg:grid-cols-[0.9fr_1.1fr]">
          <MarketingMediaFrame
            media={homepage.preventionCallout}
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
                <Link href={MARKETING_ROUTES.annualHealthCheck}>The Annual Health Check <span aria-hidden>→</span></Link>
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
            {/* Corrected 2026-09-05: this used to say "download the app for
                iPhone and Android" and "search TarragonHealth in the App
                Store or Google Play". Neither store listing exists — there is
                no apps.apple.com or play.google.com URL anywhere in the repo,
                apps/mobile/eas.json has an empty production submit config,
                and distribution today is an internal preview build. A visitor
                who searched would find nothing. What IS true is the PWA: see
                apps/web/src/app/manifest.ts (standalone display, installable
                from the browser). Restore store wording only once a listing is
                actually live. */}
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Tarragon works in any phone browser today, and you can add it to your home screen so
              it opens like an app. The same secure record you already use on the web, with your
              care team in your pocket whenever you need them. Native apps for iPhone and Android
              are coming.
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
            <p className="mt-3 text-sm text-charcoal-ink/65">
              Already have an account? Sign in on your phone browser, then use your browser&apos;s
              &quot;Add to Home Screen&quot; option to keep Tarragon one tap away.
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
              body: "The app is free. See exactly what a doctor's time costs.",
            },
          ].map((item) => (
            <Card
              key={item.href}
              asChild
              className="hover:border-brand-green/40 focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
            >
              <Link href={item.href} className="group block p-6 focus-visible:outline-none">
                <h3 className="font-heading text-lg font-semibold text-charcoal-ink group-hover:text-brand-green">
                  {item.title}
                  <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      <Section variant="navy">
        <SectionHeading
          eyebrow="Why people trust Tarragon"
          title="Built to be accountable to you"
          invert
          size="large"
        />
        <TrustBand />
      </Section>

      <PartnerLogoStrip />

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
