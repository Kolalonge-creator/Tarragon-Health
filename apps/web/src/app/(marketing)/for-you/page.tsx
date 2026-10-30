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
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

// Retitled from "For you", which competed head-on with /who-its-for in search
// and in the footer: two pages, one apparent question. This is the INDIVIDUAL's
// page (the audience strip already called it "For individuals"); /who-its-for
// is the router that sends each audience here or to /parentcare, /corporate,
// /hmo.
export const metadata: Metadata = pageMetadata({
  title: "For individuals",
  description:
    "The free app for individuals: monitoring for hypertension, diabetes and weight, preventive screening, medication support and lab coordination, one record.",
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
      label: "A single short visit",
      body: "You book an appointment, wait several weeks, and then have about ten minutes with a doctor.",
    },
    withTarragon: {
      label: "A team that keeps watching",
      body: "Message your care team at any time, receive a doctor's written answer within 72 hours, and, with Membership, have a video call with your care team every month.",
    },
  },
  {
    theOldWay: {
      label: "Whatever panel your doctor happens to order",
      body: "Testing usually means one standard panel of tests, ordered on the day, with no easy way to arrange it yourself.",
    },
    withTarragon: {
      label: "A Health Check that matches you",
      body: "Choose from a Core Screen to a Comprehensive Screen, and request confidential screenings yourself in minutes. We write the test request, you use any laboratory, and a doctor reads the result.",
    },
  },
  {
    theOldWay: {
      label: "Fragmented care",
      body: "One doctor prescribes your medication, a different laboratory holds your results, and messages are spread across several apps, so nobody sees the whole picture.",
    },
    withTarragon: {
      label: "One record, one care team",
      body: "Your vital signs, medications, laboratory results, screenings and referrals are kept on a single dashboard that every clinician treating you can see.",
    },
  },
  {
    theOldWay: {
      label: "Reactive care",
      body: "Nothing happens until you notice that something is wrong and seek help yourself.",
    },
    withTarragon: {
      label: "Proactive care",
      body: "Your screening and vaccination calendar is created for you, and an abnormal result reaches a doctor automatically, even if you have no symptoms.",
    },
  },
  {
    theOldWay: {
      label: "Medication as the only answer",
      body: "Medication is often the first and only treatment, refilled again and again.",
    },
    withTarragon: {
      label: "A plan built around the cause",
      body: "Lifestyle coaching alongside medication, regular reviews, and the ability to stop a drug recorded as a real outcome, rather than another refill.",
    },
  },
];

const MONTH_WITH_TARRAGON = [
  {
    title: "You record your readings",
    body: "A blood pressure reading, a glucose check or your weekly weight each takes under a minute to enter in the app, and is saved to one secure record instead of a paper notebook. We are also introducing automatic syncing from Apple Health, Health Connect, and trackers such as Fitbit, Garmin, Oura, WHOOP and Dexcom, so that readings can be added without typing.",
  },
  {
    title: "Reminders help you stay consistent",
    body: "In-app and push reminders arrive when a dose, reading or check is due, so you do not have to rely on memory. You can also message your care team at any time in the app.",
  },
  {
    title: "A doctor reviews your readings",
    body: "On the 12-week doctor-supported programme, a doctor sets your care plan and reviews your trends on a regular schedule, even when you feel well. This is the difference between owning a blood pressure monitor and having your blood pressure monitored.",
  },
  {
    title: "Laboratory tests and refills are arranged for you",
    body: "When a test is due or medication runs low, Tarragon tells you, writes you the request, and follows it until a doctor has read the result. You choose the laboratory or pharmacy and pay them directly.",
  },
  {
    title: "Healthy habits earn wellness points",
    body: "Recording a reading, finishing a lesson or completing a challenge earns wellness points and badges, free for everyone. Points show your progress. They are not money.",
  },
  {
    title: "A doctor is involved when it is needed",
    body: "Steady readings receive routine follow-up. A worrying pattern is passed to a doctor through a defined clinical pathway, so you can be sure that someone has noticed.",
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
              Monitor your health with a care team beside you
            </h1>
            <p className="mt-4 font-heading text-lg text-brand-green">
              Your readings and your health risks are personal to you, so your care should be planned around them.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Many people only discover a health problem when it becomes an emergency. Tarragon gives you
              what a well-run clinic gives its most closely followed patients: someone who monitors your
              readings between visits, through your phone, at a fraction of the cost of a hospital admission.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">Get started</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={MARKETING_ROUTES.pricing}>See what things cost</Link>
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
          title="The care most people receive, compared with Tarragon"
          description="This is what changes when someone monitors your readings between visits."
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
          description="This is what happens after you join, step by step."
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
          title="Programmes built around your whole health"
          description="Long-term care for hypertension, diabetes and weight; preventive screening to find problems early; and medication and laboratory support, all on one shared record."
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
          title="Free to start, with doctor care when you want it"
        />
        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            The app is free and stays free. You can record your own readings, receive your screening
            calendar, read the whole education library and use the AI Health Coach, with no time limit
            and no payment card required. If you want your care team to review your readings, rather
            than only store them, there is Membership. With Membership, a dangerous reading reaches a
            doctor on your care team instead of sitting on your record, and you also receive a yearly
            blood test and a video call with your care team every month.
          </p>
          <p>
            There are two plans, Free and Membership, and the{" "}
            <Link href={MARKETING_ROUTES.pricing} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              pricing page
            </Link>{" "}
            shows both. If you are looking after a parent instead, see{" "}
            <Link href={MARKETING_ROUTES.parentcare} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              Caring for a parent
            </Link>{" "}
            for how Tarragon supports you.
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
          description="Get started today. Setting up takes only a few minutes."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
