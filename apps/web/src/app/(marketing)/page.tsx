import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ChannelHero } from "./_components/channel-hero";
import { ContinuityPath } from "./_components/continuity-path";
import { CtaBand } from "./_components/cta-band";
import { PhotoBannerHero } from "./_components/marketing-photo-banner-hero";
import { MarketingVideo } from "./_components/marketing-video";
import { Section, SectionHeading } from "./_components/section";
import { StoryPanel } from "./_components/story-panel";
import { TestimonialsSection } from "./_components/testimonials-section";
import { DoctorTestimonialsSection } from "./_components/doctor-testimonials-section";
import { PhoneMockup } from "./_components/phone-mockup";
import { EmergencyNotice } from "./_components/emergency-notice";
import { TrustBand } from "./_components/trust-band";
import { PartnerLogoStrip } from "./_components/partner-logo-strip";
import { StepsExplorer } from "./_components/steps-explorer";
import { FaqAccordion } from "./_components/marketing-faq-accordion";
import { HomeEntryChips } from "./_components/home-entry-chips";
import { HomePlanCompare } from "./_components/home-plan-compare";
import { HomeBusinessDoor } from "./_components/home-business-door";
import { MARKETING_MEDIA } from "./_content/media";
import { HOME_HOW_IT_WORKS, PROOF_STATS, SERVICE_CARDS } from "./_content/services";
import { DEFAULT_HERO } from "./_content/channel-heroes";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { MEMBERSHIP_INCLUDES, membershipAutoRenews, membershipPriceLabel, refundWindowDays, renewalCopy } from "@/lib/marketing/membership";

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
    // Kept <= 160 chars: apps/web/src/lib/marketing/page-metadata.test.ts
    // enforces MAX_DESCRIPTION = 160 as a hard stop across every marketing
    // page (Google truncates a listing there).
    description:
      "Free to join. Tarragon watches your blood pressure, sugar, medication and screenings between doctor visits, and brings in a doctor when a result needs one.",
    path: "/",
  }),
  title: { absolute: HOME_TITLE },
};

/**
 * ISR, not per-request rendering. The only live data on this page is the
 * testimonials blocks (anon key, published rows only), and an hour-stale
 * quote is fine; docs/MARKETING_SITE_SPEC.md §4 requires marketing pages to
 * be static or ISR.
 */
export const revalidate = 3600;

/**
 * Four questions a first-time visitor actually has, answered with the same
 * facts /pricing and /services state. FAQPage structured data is emitted for
 * them below. Redesign 2026-10-26: the homepage previously had no FAQ at all.
 */
function homeFaq(price: string, refundDays: number, autoRenews: boolean) {
  return [
    {
      question: "Is Tarragon really free?",
      answer: `Yes. The app is free, with no time limit and no card. Membership is optional: ₦${price} a year, and it adds a yearly blood test and a video call with your care team every month.`,
    },
    {
      question: "Do I need a diagnosis to join?",
      answer:
        "No. Many people join to stay well: you get a screening and vaccination calendar built for you and a yearly health check. If you do have a condition, we follow it between your doctor visits.",
    },
    {
      question: "What happens if a reading is dangerous?",
      answer:
        "You get clear guidance and a specific next step straight away. If a dangerous reading goes unacknowledged, the person you named as next of kin is contacted too.",
    },
    {
      question: "Does Membership renew by itself?",
      answer: renewalCopy(autoRenews, refundDays).faqAnswer,
    },
  ];
}

export default async function MarketingHomePage() {
  const { homepage } = MARKETING_MEDIA;
  const { walkthroughVideo } = homepage;
  const price = membershipPriceLabel();
  const refundDays = refundWindowDays();
  const autoRenews = await membershipAutoRenews();
  const faq = homeFaq(price, refundDays, autoRenews);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />

      {/* Full-bleed photo hero, rendered outside Section on purpose (see the
          component's own header comment). Hero copy is channel-gated:
          `?channel=hmo|employer|diaspora` swaps the headline/CTA for that
          traffic source (see _content/channel-heroes.ts); everything below
          the fold is the same page for every visitor. */}
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
            videoSrc={homepage.hero.videoSrc}
          />
        }
      >
        <ChannelHero
          imageSrc={homepage.hero.imageSrc ?? ""}
          imageAlt={homepage.hero.imageAlt ?? ""}
          imagePosition={homepage.hero.imageFocus}
          videoSrc={homepage.hero.videoSrc}
        />
      </Suspense>

      {/* 2. Something to do in the first screen-and-a-half. */}
      <HomeEntryChips />

      {/* 3. The four commitments, then the care path they sit on. */}
      <Section className="py-6 sm:py-8">
        <div className="grid gap-4 rounded-2xl border border-charcoal-ink/10 bg-white p-4 shadow-sm sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          {PROOF_STATS.map((stat) => (
            <Card key={stat.label} variant="soft" className="border-0 shadow-none">
              <CardContent className="p-5">
                {/* Deliberately NOT AnimatedNumber: that component serves
                    "0 hrs on a critical result" in the server HTML for
                    anyone without JavaScript. A count-up flourish is fine
                    over a headcount; it is not fine over a clinical
                    commitment a visitor is being asked to trust. */}
                <p className="font-heading text-3xl font-bold text-brand-green">{stat.value}</p>
                <p className="mt-1 font-heading text-sm font-semibold uppercase tracking-wide text-charcoal-ink">
                  {stat.label}
                </p>
                <p className="mt-2 text-sm text-charcoal-ink/65">{stat.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-10">
          <ContinuityPath />
        </div>
      </Section>

      {/* 4. The gap. */}
      <Section variant="sage">
        <StoryPanel
          eyebrow="The gap"
          title="You were fine when you left the hospital. Then what?"
          description="You got a diagnosis, a prescription, and a date to come back in three months. In between, readings drift, drugs run out, and the test you were told to do slips. Nobody is watching, so nothing gets caught early."
          media={homepage.problem}
        />
      </Section>

      {/* 5. How it works, with the phone. The old separate "Take Tarragon
          with you" section is folded into the note under the steps. */}
      <Section>
        <SectionHeading
          eyebrow="How it works"
          title="Five minutes to set up. Then we keep watch."
          description="You log what is easy to log. Every reading is checked against your care protocols, you get a nudge when something is due, and a doctor is brought in when a result needs one."
        />
        <div className="mx-auto grid max-w-5xl items-start gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <StepsExplorer
            steps={HOME_HOW_IT_WORKS.map(({ title, body }) => ({ title, body }))}
            tone="green"
          />
          <PhoneMockup
            className="relative mx-auto"
            src={homepage.solution.imageSrc ?? ""}
            alt={homepage.solution.imageAlt ?? ""}
            width={1206}
            height={1650}
            showNotch
          />
        </div>
        {/* Truthful about the apps: no store listing is confirmed (see
            docs/PLAY_STORE_SUBMISSION.md), so the web app is the product and
            the native apps are "coming". Do not add store badges until a
            listing is confirmed live. */}
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          Tarragon works in any phone browser. Add it to your home screen and it opens like an app,
          with the same secure record and your care team in your pocket. Native apps for iPhone and
          Android are coming.{" "}
          <Link href={MARKETING_ROUTES.services} className="font-medium text-brand-green hover:underline">
            See the full walkthrough
          </Link>
        </p>
      </Section>

      {/* 6. What it costs: Free vs Membership, price from config. */}
      <Section variant="sage">
        <SectionHeading
          eyebrow="What it costs"
          title="Free to start. Membership when you want a doctor involved."
          description="Two plans, nothing in between. Everything you can do yourself costs nothing."
        />
        <HomePlanCompare price={price} refundDays={refundDays} membershipIncludes={MEMBERSHIP_INCLUDES} autoRenews={autoRenews} />
      </Section>

      {/* 7. Two ways in, then the three programmes as cards. */}
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
                A screening and vaccination calendar built for you, plus a yearly health check. You
                don&apos;t need a diagnosis to belong here.
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
                Monitored between visits, and escalated to a doctor when a result needs one.
              </p>
            </Link>
          </Card>
        </div>
        <div className="mx-auto mt-6 grid max-w-4xl gap-4 sm:grid-cols-3">
          {SERVICE_CARDS.filter((card) => ["hypertension", "diabetes", "obesity"].includes(card.key)).map(
            (service) => (
              <Card
                key={service.key}
                asChild
                variant="soft"
                className="border-0 shadow-none hover:shadow-sm focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
              >
                <Link href={service.href} className="group block p-6 focus-visible:outline-none">
                  <h3 className="font-heading text-base font-semibold text-charcoal-ink group-hover:text-brand-green">
                    {service.title} <span aria-hidden>→</span>
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{service.description}</p>
                </Link>
              </Card>
            )
          )}
        </div>
      </Section>

      {/* Same rule the product pages follow (see PRODUCT_VIDEOS in
          _content/media.ts: "empty youtubeId = section not rendered"). */}
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

      {/* 8. The B2B front door. */}
      <HomeBusinessDoor />

      {/* 9. Trust, then proof. Partners and testimonials render only real,
          consented, published entries (see their component headers); until
          there are any, they leave no gap. */}
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

      <DoctorTestimonialsSection />

      {/* 10. FAQ. */}
      <Section>
        <SectionHeading eyebrow="Questions" title="Before you sign up" />
        <FaqAccordion items={faq} variant="minimal" />
        <p className="mt-6 text-center text-sm">
          <Link href={MARKETING_ROUTES.faq} className="font-medium text-brand-green hover:underline">
            More questions and answers
          </Link>
        </p>
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      {/* 11. Closing call to action. */}
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
