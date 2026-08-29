import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { DashboardPreview } from "../_components/dashboard-preview";
import { EmergencyNotice } from "../_components/emergency-notice";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { SERVICE_CARDS } from "../_content/services";
import { NGN_TIERS } from "../_content/pricing";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

// Superseded 2026-08-29: Essential/Complete Care are retired, replaced by Care Pass.
const CARE_PASS_TIER = NGN_TIERS.find((tier) => tier.id === "care_pass_12mo")!;

export const metadata: Metadata = pageMetadata({
  title: "For you",
  description:
    "What TarragonHealth does for you as an individual: doctor-reviewed monitoring for hypertension, diabetes, and weight management, preventive screening, medication support, and lab coordination on one record.",
  path: MARKETING_ROUTES.forYou,
});

/** Everything an individual patient uses. Caring for a parent has its own page. */
const FOR_YOU_CARDS = SERVICE_CARDS.filter((card) => card.key !== "parentcare");

const CARE_COMPARISON: {
  theOldWay: { label: string; body: string };
  withTarragon: { label: string; body: string };
}[] = [
  {
    theOldWay: {
      label: "One rushed visit",
      body: "Book, wait weeks for an appointment, then get ten minutes of a doctor's time.",
    },
    withTarragon: {
      label: "A team that keeps watching",
      body: "Message your care team anytime, get an async doctor's answer within 72 hours, and book a paid 15-minute online consultation only when you actually need one.",
    },
  },
  {
    theOldWay: {
      label: "Whatever panel your doctor happens to order",
      body: "Testing usually means one flat panel, ordered on the day, with no easy way to book it yourself.",
    },
    withTarragon: {
      label: "A Health Check that matches you",
      body: "From a Core Screen to a Comprehensive Screen, plus confidential screenings you can request yourself in minutes. We write the request, you use any lab, a doctor reads it.",
    },
  },
  {
    theOldWay: {
      label: "Scattered care",
      body: "One doctor for medication, another lab for results, a WhatsApp thread for everything else, nobody connecting the dots.",
    },
    withTarragon: {
      label: "One record, one care team",
      body: "Vitals, medications, labs, screenings and referrals live on a single dashboard that every clinician treating you can see.",
    },
  },
  {
    theOldWay: {
      label: "Reactive",
      body: "Nothing happens until you notice something is wrong and go looking for help.",
    },
    withTarragon: {
      label: "Proactive",
      body: "Your screening and vaccination calendar builds itself, and an abnormal result reaches a doctor automatically, no symptom required to trigger it.",
    },
  },
  {
    theOldWay: {
      label: "Another prescription",
      body: "Medication is often the first and only lever, refilled again and again.",
    },
    withTarragon: {
      label: "A plan built around the cause",
      body: "Lifestyle coaching alongside medication, regular reviews, and stopping a drug tracked as a real outcome, not just another refill.",
    },
  },
];

const MONTH_WITH_TARRAGON = [
  {
    title: "You log, in seconds",
    body: "A blood pressure reading after breakfast, a glucose check, your weight once a week: each takes under a minute in the app, and lands on one secure record instead of a paper notebook. We're also rolling out automatic sync from Apple Health, Health Connect, and trackers like Fitbit, Garmin, Oura, WHOOP, and Dexcom, connection by connection, for when you'd rather it fill itself in.",
  },
  {
    title: "Reminders keep you consistent",
    body: "WhatsApp and SMS nudges arrive when a dose, reading, or check is due, so consistency stops depending on memory. You can also message your care team any time, right in the app, whenever you have a question.",
  },
  {
    title: "A doctor actually reviews your numbers",
    body: "On paid plans, a doctor sets your care plan and reviews your trends on a scheduled basis, even when you feel fine. That's the difference between owning a BP monitor and being monitored.",
  },
  {
    title: "Labs and refills are arranged for you",
    body: "When a test is due or medication runs low, Tarragon tells you, writes you the request, and follows it until a doctor has read the result. You choose the laboratory or pharmacy and pay them directly.",
  },
  {
    title: "Small habits earn real rewards",
    body: "Logging a reading, finishing a lesson, or completing a challenge earns wellness points, free on every plan. Collect badges along the way, and redeem points any time for a reward voucher that comes off the price of your care.",
  },
  {
    title: "Escalation only when it's needed",
    body: "Steady numbers get calm follow-up. A worrying pattern gets escalated through a defined clinical pathway, quickly and without drama; you are never left wondering whether anyone noticed.",
  },
];

export default function ForYouPage() {
  return (
    <>
      <Section className="pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">For you</p>
            <h1 className="mt-2 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
              Track your health without carrying it alone
            </h1>
            <p className="mt-4 font-heading text-lg text-brand-green">
              Your numbers are yours. Your risk is yours. Your plan should be too.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Most people only discover a problem when it becomes an emergency. Tarragon gives you
              what a well-run clinic gives its best-followed patients: someone watching your numbers
              between visits, through your phone, at a fraction of the cost of a single hospital
              admission.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">Get started</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={MARKETING_ROUTES.pricing}>Find your plan</Link>
              </Button>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-3xl bg-soft-sage/40">
            <Image
              src="/marketing/illustrations/telehealth-video-consult.png"
              alt="A patient having a video consultation with a doctor from home"
              width={1456}
              height={816}
              className="h-auto w-full"
              priority
            />
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="How it compares"
          title="The care most people get, and the care Tarragon gives you"
          description="No fear, no jargon: just what changes when someone is actually watching your numbers between visits."
        />
        <div className="mx-auto max-w-4xl overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-0 overflow-hidden rounded-2xl border border-charcoal-ink/10 bg-white text-sm">
            <thead>
              <tr className="bg-warm-ivory text-left">
                <th scope="col" className="w-1/2 p-4 font-heading font-semibold text-charcoal-ink">
                  The way most people get care
                </th>
                <th scope="col" className="w-1/2 p-4 font-heading font-semibold text-charcoal-ink">
                  With TarragonHealth
                </th>
              </tr>
            </thead>
            <tbody>
              {CARE_COMPARISON.map((row) => (
                <tr key={row.theOldWay.label} className="border-t border-charcoal-ink/10">
                  <td className="border-t border-charcoal-ink/10 p-4 align-top">
                    <p className="font-medium text-charcoal-ink/60">{row.theOldWay.label}</p>
                    <p className="mt-1 text-charcoal-ink/70">{row.theOldWay.body}</p>
                  </td>
                  <td className="border-t border-charcoal-ink/10 p-4 align-top">
                    <p className="font-medium text-deep-forest">{row.withTarragon.label}</p>
                    <p className="mt-1 text-charcoal-ink/70">{row.withTarragon.body}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What it's like"
          title="A month on Tarragon"
          description="No jargon, no hospital queues: here is what actually happens once you join."
        />
        <ol className="mx-auto grid max-w-3xl gap-6">
          {MONTH_WITH_TARRAGON.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-semibold text-white"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{step.title}</h3>
                <p className="mt-1 text-charcoal-ink/70">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="What we help you manage"
          title="Programmes built around your health, not one symptom"
          description="Chronic care for hypertension, diabetes, and weight; preventive screening to stay ahead; medication and lab support to keep everything on track, all on one shared record."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FOR_YOU_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <DashboardPreview />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Start where you are"
          title="Free to start, real care when you want it"
        />
        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            Tarragon Free lets you track your own numbers forever, at no cost; it never expires and
            never converts to a paid plan on its own. When you want a doctor actually reviewing your
            readings, Care Pass is {CARE_PASS_TIER.priceMain} {CARE_PASS_TIER.pricePeriod}, one
            payment covering hypertension, diabetes, and weight together on one scheduled care plan —
            no card stored, no auto-renewal.
          </p>
          <p>
            Not sure which fits? The three-question plan finder on the{" "}
            <Link href={MARKETING_ROUTES.pricing} className="font-medium text-deep-forest hover:underline">
              pricing page
            </Link>{" "}
            points you to the right one. And looking after a parent instead?{" "}
            <Link href={MARKETING_ROUTES.parentcare} className="font-medium text-deep-forest hover:underline">
              Caring for a parent
            </Link>{" "}
            is built exactly for that.
          </p>
        </div>
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Care that stays with you."
          description="Get started today; it takes minutes to set up."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
