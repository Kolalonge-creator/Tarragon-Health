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
import { HomeLadderCompare } from "./_components/home-ladder-compare";
import { HomePlanCompare } from "./_components/home-plan-compare";
import { ladderCards } from "./_content/pricing-ladder";
import { HomeBusinessDoor } from "./_components/home-business-door";
import { MARKETING_MEDIA } from "./_content/media";
import { HOME_HOW_IT_WORKS, PROOF_STATS, SERVICE_CARDS } from "./_content/services";
import { DEFAULT_HERO } from "./_content/channel-heroes";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { MEMBERSHIP_INCLUDES, paidProductName, membershipAutoRenews, membershipLadderPriceLabels, membershipLadderPublic, membershipPriceLabel, refundWindowDays, renewalCopy } from "@/lib/marketing/membership";

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
function homeFaq(price: string, refundDays: number, autoRenews: boolean, ladder: { evergreen: string; evergreenPlus: string } | null) {
  return [
    {
      question: "Is Tarragon really free?",
      answer: ladder
        ? `Yes. The app is free, with no time limit and no payment card needed. Membership (${ladder.evergreen} a year) and Membership Plus (${ladder.evergreenPlus} a year) are optional. Both add a video call with your care team every month, and Membership Plus also includes the yearly blood panel (a set of blood tests).`
        : `Yes. The app is free, with no time limit and no payment card needed. ${paidProductName()} is optional: ₦${price} a year, and it includes a yearly blood test collected for you and a video call with your care team every month. Anyone can also request the annual test bundle and pay the laboratory directly.`,
    },
    {
      question: "Do I need a diagnosis to join?",
      answer:
        "No. Many people join to stay well. You receive a screening and vaccination calendar based on your age and history, and a yearly health check. If you do have a condition, we follow it between your appointments.",
    },
    {
      question: "What happens if a reading is dangerous?",
      answer:
        "You receive clear guidance and a specific next step straight away. If you do not acknowledge a dangerous reading, the person you named as your next of kin is contacted as well.",
    },
    {
      question: ladder ? "Does Membership renew by itself?" : `Does ${paidProductName()} renew by itself?`,
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
  const ladderPrices = membershipLadderPublic() ? membershipLadderPriceLabels() : null;
  const faq = homeFaq(price, refundDays, autoRenews, ladderPrices);
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
          title="Between hospital visits, nobody is watching your health"
          description="After a diagnosis you usually leave with a prescription and an appointment in three months. In between, your readings can drift, your medication can run out, and a test you were asked to do can be forgotten. Because nobody is watching, problems are often found late."
          media={homepage.problem}
        />
      </Section>

      {/* 5. How it works, with the phone. The old separate "Take Tarragon
          with you" section is folded into the note under the steps. */}
      <Section>
        <SectionHeading
          eyebrow="How it works"
          title="Setting up takes about five minutes, then we keep watch"
          description="You record the readings that are easy for you to take. Each reading is checked against your care protocols, you receive a reminder when something is due, and a doctor reviews your case when a result needs it."
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
          Tarragon works in any phone browser. If you add it to your home screen, it opens like an app
          and gives you the same secure record and access to your care team. Native apps for iPhone
          and Android are planned.{" "}
          <Link href={MARKETING_ROUTES.services} className="font-medium text-brand-green hover:underline">
            See the full walkthrough
          </Link>
        </p>
      </Section>

      {/* 6. What it costs: Free vs Membership, price from config. */}
      <Section variant="sage">
        <SectionHeading
          eyebrow="What it costs"
          title={ladderPrices ? "Free, Membership or Membership Plus" : `Free to start. ${paidProductName()} when you want a doctor involved.`}
          description={
            ladderPrices
              ? "Everything you can do yourself is free. Membership and Membership Plus give you a year of care with your care team. The only difference between them is the yearly blood panel."
              : "There are two plans. Everything you can do yourself is free."
          }
        />
        {ladderPrices ? (
          <HomeLadderCompare cards={ladderCards(ladderPrices)} refundDays={refundDays} autoRenews={autoRenews} />
        ) : (
          <HomePlanCompare price={price} refundDays={refundDays} membershipIncludes={MEMBERSHIP_INCLUDES} autoRenews={autoRenews} />
        )}
      </Section>

      {/* 7. Two ways in, then the three programmes as cards. */}
      <Section>
        <SectionHeading
          eyebrow="Start where you are"
          title="Two ways to start, one health record"
          description="Tarragon is for people managing a long-term condition, and equally for people who do not have one and want to stay well."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          <Card
            asChild
            className="rounded-2xl border-brand-green/25 hover:border-brand-green/50 focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
          >
            <Link href={MARKETING_ROUTES.prevention} className="group block p-8 focus-visible:outline-none">
              <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
                I am healthy
              </p>
              <h3 className="mt-2 font-heading text-xl font-semibold text-charcoal-ink group-hover:text-brand-green">
                Stay well <span aria-hidden>→</span>
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
                A screening and vaccination calendar based on your age and history, plus a yearly
                health check. You do not need a diagnosis to join.
              </p>
            </Link>
          </Card>
          <Card
            asChild
            className="rounded-2xl hover:border-brand-green/40 focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
          >
            <Link href={MARKETING_ROUTES.chronicCare} className="group block p-8 focus-visible:outline-none">
              <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
                I am managing a condition
              </p>
              <h3 className="mt-2 font-heading text-xl font-semibold text-charcoal-ink group-hover:text-brand-green">
                Get regular follow-up <span aria-hidden>→</span>
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
                Your readings are monitored between visits, and a doctor reviews your case when a result needs it.
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
          title="Designed so that we are accountable to you"
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
        <SectionHeading eyebrow="Questions" title="Questions before you sign up" />
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
          description="Get started today, for yourself or for someone you care for."
          primaryHref="/signup"
          primaryLabel="Get started"
        />
      </Section>
    </>
  );
}
