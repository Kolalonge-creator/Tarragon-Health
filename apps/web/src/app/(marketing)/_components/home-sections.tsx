import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  FlaskConical,
  HeartHandshake,
  RefreshCw,
  Stethoscope,
  UserRound,
  Users,
  Activity,
  BookOpen,
  ShieldCheck,
} from "lucide-react";
import { Section } from "./section";
import { ExamplePhone } from "./home-example-screens";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { PARTNER_LOGOS, SYNLAB_PARTNER_LINE } from "../_content/partners";
import { TEAM } from "../_content/leadership";

/**
 * Homepage sections, website upgrade Phase 1 (2026-11-05,
 * docs/plans/website-redesign/00-phase0-plan.md section 4). One idea per
 * section, in the order the plan sets. Every claim here describes something
 * live today; anything that depends on Membership says so, because doctor
 * review of a plan or an uploaded result is a Membership feature.
 *
 * No price is typed in this file: the employer seat price arrives as a prop
 * from the page, which reads it from versioned config
 * (lib/marketing/membership.ts), and no-public-prices.test.ts guards that.
 */

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-mk-canvas";

function Eyebrow({ children, invert = false }: { children: React.ReactNode; invert?: boolean }) {
  return (
    <p className={`text-sm font-semibold uppercase tracking-wider ${invert ? "text-sprout-gold" : "text-brand-green"}`}>
      {children}
    </p>
  );
}

function Heading({ id, children, invert = false }: { id: string; children: React.ReactNode; invert?: boolean }) {
  return (
    <h2
      id={id}
      className={`text-balance font-heading text-3xl font-medium leading-tight sm:text-4xl ${invert ? "text-white" : "text-charcoal-ink"}`}
    >
      {children}
    </h2>
  );
}

/* 2. Audience router ------------------------------------------------------ */

const AUDIENCES = [
  { href: MARKETING_ROUTES.membership, title: "For me", detail: "A free account, or Membership", Icon: UserRound },
  { href: MARKETING_ROUTES.families, title: "For a parent or relative", detail: "Support someone in Nigeria from anywhere", Icon: HeartHandshake },
  { href: MARKETING_ROUTES.corporate, title: "For my employees", detail: "Membership for your whole team", Icon: BriefcaseBusiness },
] as const;

export function HomeAudienceRouter() {
  return (
    <nav aria-label="Who Tarragon is for" className="px-4 sm:px-6">
      <ul className="mx-auto grid max-w-6xl gap-3 md:grid-cols-3">
        {AUDIENCES.map(({ href, title, detail, Icon }) => (
          <li key={title}>
            <Link
              href={href}
              className={`group flex min-h-[76px] items-center gap-4 rounded-2xl border border-mk-border bg-white px-5 py-4 transition-colors hover:border-brand-green/50 ${FOCUS}`}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-soft-sage text-brand-green">
                <Icon aria-hidden className="h-[22px] w-[22px]" />
              </span>
              <span className="grid min-w-0">
                <span className="text-base font-semibold text-charcoal-ink">{title}</span>
                <span className="text-sm text-mk-muted">{detail}</span>
              </span>
              <ArrowRight aria-hidden className="ml-auto h-5 w-5 shrink-0 text-brand-green transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
      {/* Kept from the old entry chips: where we work belongs near the top of
          the page, not only in the footer. */}
      <p className="mx-auto mt-4 max-w-6xl text-[15px] text-mk-muted">
        Tarragon works anywhere in Nigeria.{" "}
        <Link href={MARKETING_ROUTES.coverage} className={`inline-block rounded-sm py-1 font-semibold text-brand-green hover:underline ${FOCUS}`}>
          See where we work
        </Link>
      </p>
    </nav>
  );
}

/* 3. The problem ---------------------------------------------------------- */

const PROBLEMS = [
  { title: "Check-ups happen once and stop", body: "A result is printed, filed and rarely followed up." },
  { title: "Laboratory reports are hard to read", body: "Numbers and ranges, with no plain explanation of what they mean for you." },
  { title: "Records are scattered", body: "Laboratories, clinics and pharmacies each keep their own part of your story." },
  { title: "Families are far apart", body: "Children abroad want to help a parent at home but cannot see what is needed." },
] as const;

export function HomeProblem() {
  return (
    <Section labelledBy="home-problem-title">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="grid content-start gap-4">
          <Eyebrow>Why Tarragon</Eyebrow>
          <Heading id="home-problem-title">Your health information should work together.</Heading>
          <p className="text-lg leading-relaxed text-charcoal-ink/80">
            Many people manage their health in pieces: a test here, a clinic visit there, and nobody looking at the
            whole picture over time.
          </p>
        </div>
        <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {PROBLEMS.map((p) => (
            <li key={p.title} className="grid gap-1 border-t border-mk-border pt-4">
              <span className="font-semibold text-charcoal-ink">{p.title}</span>
              <span className="text-mk-muted">{p.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* 4. One connected journey ------------------------------------------------ */

const STEPS = [
  { title: "Create your health profile", body: "Answer a short assessment about your history, family and lifestyle." },
  { title: "Get your personal plan", body: "A plan built from signed care protocols, fitted to your age, history and family." },
  { title: "Do the recommended tests", body: "Download your request form and use any eligible laboratory you choose." },
  { title: "Upload and understand results", body: "Upload the report. We organise the values and a doctor reviews them." },
  { title: "Keep going", body: "Reminders, a monthly online doctor meeting and follow-up keep you on track." },
] as const;

export function HomeJourney() {
  return (
    <Section id="how" variant="sage" labelledBy="home-journey-title">
      <div className="mb-10 grid max-w-3xl gap-3">
        <Eyebrow>How it works</Eyebrow>
        <Heading id="home-journey-title">One connected way to look after your health.</Heading>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step, i) => (
          <li key={step.title} className="grid content-start gap-2 rounded-2xl bg-white p-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-green">Step {i + 1}</span>
            <span className="text-lg font-semibold leading-snug text-charcoal-ink">{step.title}</span>
            <span className="text-[15px] text-mk-muted">{step.body}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 grid gap-2 text-charcoal-ink sm:flex sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 font-medium">
          <RefreshCw aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
          Each new result updates your plan, so next year starts from what we learned this year.
        </p>
        <p className="text-sm text-mk-muted">Your plan and a doctor&apos;s review of your results are part of Membership.</p>
      </div>
    </Section>
  );
}

/* 5. Inside the app ------------------------------------------------------- */

export function HomeShowcase() {
  const shots = [
    { screen: "plan" as const, caption: "A plan made for you" },
    { screen: "trend" as const, caption: "Trends a doctor watches with you" },
    { screen: "review" as const, caption: "Plain-English explanations" },
  ];
  return (
    <Section labelledBy="home-showcase-title">
      <div className="mb-10 grid max-w-3xl gap-3">
        <Eyebrow>Inside the app</Eyebrow>
        <Heading id="home-showcase-title">See your health over time, not one result at a time.</Heading>
        <p className="text-lg text-charcoal-ink/80">These are example screens with made-up details. The app shows your own record.</p>
      </div>
      {/* On a phone the three screens sit side by side in a swipeable row
          (scroll-snap, no script) instead of stacking into three phone
          heights of scrolling; from md up they are a three-column grid. */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Example app screens"
        className={`-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-3 md:items-end md:gap-6 md:overflow-visible md:px-0 md:pb-0 ${FOCUS}`}
      >
        {shots.map(({ screen, caption }) => (
          <figure key={screen} className="grid w-[72%] shrink-0 snap-center justify-items-center gap-3 md:w-auto">
            <ExamplePhone screen={screen} className="w-full max-w-[250px]" />
            <figcaption className="text-center font-medium text-charcoal-ink">{caption}</figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

/* 6. Services ------------------------------------------------------------- */

const SERVICES = [
  {
    title: "Personal preventive care",
    items: ["Health assessment and risk review", "A personal preventive plan", "Screening that fits your age and history"],
    href: MARKETING_ROUTES.prevention,
    cta: "Explore preventive care",
    Icon: ShieldCheck,
  },
  {
    title: "Laboratory and diagnostic coordination",
    items: ["Request forms for any eligible laboratory", "Find laboratories near you", "Secure report upload"],
    href: MARKETING_ROUTES.labs,
    cta: "Explore diagnostic services",
    Icon: FlaskConical,
  },
  {
    title: "Doctor consultations",
    items: ["Scheduled online meetings", "Your results explained", "Follow-up planning"],
    href: MARKETING_ROUTES.resultInterpretation,
    cta: "Explore doctor review",
    Icon: Stethoscope,
  },
  {
    title: "Ongoing health management",
    items: ["Your record and trends", "Blood pressure and other readings", "Reminders when a check is due"],
    href: MARKETING_ROUTES.monitoring,
    cta: "Explore monitoring",
    Icon: Activity,
  },
  {
    title: "Family support",
    items: ["Care Circle, with your consent", "Pay for a relative's Membership", "You control what is shared"],
    href: MARKETING_ROUTES.families,
    cta: "Explore family support",
    Icon: Users,
  },
  {
    title: "Community and learning",
    items: ["Tarragon Community support groups", "Health articles and guides", "Free health tools"],
    href: MARKETING_ROUTES.resources,
    cta: "Explore the health library",
    Icon: BookOpen,
  },
] as const;

export function HomeServices() {
  return (
    <Section id="services" variant="sage" labelledBy="home-services-title">
      <div className="mb-10 grid max-w-3xl gap-3">
        <Eyebrow>Services</Eyebrow>
        <Heading id="home-services-title">Everything you need to stay ahead of your health.</Heading>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map(({ title, items, href, cta, Icon }) => (
          <li key={title}>
            <Link
              href={href}
              className={`group grid h-full content-start gap-3 rounded-2xl border border-mk-border bg-white p-6 transition-colors hover:border-brand-green/50 ${FOCUS}`}
            >
              <Icon aria-hidden className="h-6 w-6 text-brand-green" />
              <span className="text-lg font-semibold text-charcoal-ink">{title}</span>
              <span className="grid gap-1 text-[15px] text-mk-muted">
                {items.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </span>
              <span className="mt-1 inline-flex items-center gap-1 text-[15px] font-semibold text-brand-green">
                {cta}
                <ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* 8. Diagnostic network --------------------------------------------------- */

const DIAGNOSTIC_FACTS = [
  { title: "Search by state and area", body: "Find laboratories near you, with details we have checked." },
  { title: "Pay the provider directly", body: "Prices vary by branch. Confirm the current price with the laboratory." },
  { title: "Upload your report", body: "Your results go into your record, organised and ready for review." },
] as const;

export function HomeDiagnosticNetwork() {
  const synlab = PARTNER_LOGOS.find((p) => p.name === "Synlab");
  return (
    <Section variant="sage" labelledBy="home-diagnostic-title">
      <div className="mb-10 grid max-w-3xl gap-3">
        <Eyebrow>Diagnostic network</Eyebrow>
        <Heading id="home-diagnostic-title">Do your tests where it suits you.</Heading>
        <p className="text-lg text-charcoal-ink/80">
          You are not tied to one laboratory chain. Your request form works at any eligible laboratory in our directory.
        </p>
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {DIAGNOSTIC_FACTS.map((f) => (
          <li key={f.title} className="grid gap-1 border-t-2 border-brand-green pt-3">
            <span className="font-semibold text-charcoal-ink">{f.title}</span>
            <span className="text-mk-muted">{f.body}</span>
          </li>
        ))}
      </ul>
      {synlab ? (
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-mk-border bg-white px-5 py-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-mk-muted">Our laboratory partner</span>
          <Image src={synlab.logoSrc} alt="Synlab" width={123} height={28} className="h-7 w-auto" />
          <p className="min-w-0 flex-[1_1_320px] text-[15px] text-charcoal-ink">{SYNLAB_PARTNER_LINE}</p>
        </div>
      ) : null}
      <p className="mt-8">
        <Link
          href={MARKETING_ROUTES.labs}
          className={`inline-flex h-12 items-center justify-center rounded-full border-[1.5px] border-brand-green px-6 font-semibold text-brand-green hover:bg-brand-green/5 ${FOCUS}`}
        >
          Explore diagnostic services
        </Link>
      </p>
    </Section>
  );
}

/* 9. Families ------------------------------------------------------------- */

const SHARING_EXAMPLE = [
  { label: "Upcoming appointments", on: true },
  { label: "Blood pressure readings", on: true },
  { label: "Laboratory results", on: false },
  { label: "Doctor notes", on: false },
] as const;

export function HomeFamilies() {
  return (
    <Section labelledBy="home-families-title">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="grid content-start gap-4">
          <Eyebrow>For families</Eyebrow>
          <Heading id="home-families-title">Stay close to the health of the people you love.</Heading>
          <p className="text-lg leading-relaxed text-charcoal-ink/80">
            Living in London, Houston or Toronto and caring for a parent in Lagos? You can pay for their Membership,
            and they can choose to share parts of their care with you.
          </p>
          <ul className="grid gap-4">
            <li className="grid gap-1 border-t border-mk-border pt-4">
              <span className="font-semibold text-charcoal-ink">They stay in control</span>
              <span className="text-mk-muted">Your relative decides what you see, and can pause or stop sharing at any time.</span>
            </li>
            <li className="grid gap-1 border-t border-mk-border pt-4">
              <span className="font-semibold text-charcoal-ink">Paying is not the same as access</span>
              <span className="text-mk-muted">Paying for someone&apos;s Membership does not open their medical record to you.</span>
            </li>
          </ul>
          <p className="mt-2">
            <Link
              href={MARKETING_ROUTES.families}
              className={`inline-flex h-12 items-center justify-center rounded-full bg-brand-green px-6 font-semibold text-white hover:bg-brand-green/90 ${FOCUS}`}
            >
              Support a family member
            </Link>
          </p>
        </div>
        <div className="grid gap-1 rounded-3xl border border-mk-border bg-white p-6" role="group" aria-label="Example Care Circle sharing settings">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Example Care Circle</p>
          <p className="mb-2 text-[15px] text-mk-muted">Mrs Okafor shares with her son, Chidi</p>
          {SHARING_EXAMPLE.map(({ label, on }) => (
            <div key={label} className="flex items-center justify-between gap-3 border-b border-mk-border py-3 last:border-b-0">
              <span className="text-[15px] text-charcoal-ink">{label}</span>
              <span className={`text-sm font-semibold ${on ? "text-brand-green" : "text-mk-muted"}`}>{on ? "Shared" : "Private"}</span>
            </div>
          ))}
          <p className="mt-2 text-xs text-mk-muted">Example settings with made-up names.</p>
        </div>
      </div>
    </Section>
  );
}

/* 10. Employers ----------------------------------------------------------- */

/** `seatPrice` arrives already formatted with its ₦ sign ("₦90,000") from the page, which reads it from config. */
export function HomeEmployers({ seatPrice }: { seatPrice: string }) {
  const points = [
    "Every employee gets the same full Membership",
    "Health assessments, plans, doctor review of results and education",
    "You see group figures only, never anyone's results",
    "Health insurers and HMOs: talk to us about working together",
  ];
  return (
    <Section variant="navy" labelledBy="home-employers-title">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div className="grid content-start gap-4">
          <Eyebrow invert>For employers</Eyebrow>
          <Heading id="home-employers-title" invert>
            Build a healthier, better supported team.
          </Heading>
          <ul className="grid gap-3 text-white/90">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <Check aria-hidden className="mt-1 h-[18px] w-[18px] shrink-0 text-sprout-gold" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-3 rounded-3xl border border-white/20 bg-white/[0.07] p-7" data-testid="home-employer-seat-line">
          <p className="text-sm font-semibold uppercase tracking-wider text-sprout-gold">Employer Membership</p>
          <p className="font-heading text-4xl text-white">
            {seatPrice} <span className="font-sans text-base text-white/80">per person per year</span>
          </p>
          <p className="text-white/85">Visits to your workplace for screening are a separate service, scoped and priced for you.</p>
          <Link
            href={MARKETING_ROUTES.corporate}
            className="mt-1 inline-flex h-12 items-center justify-center justify-self-start rounded-full bg-sprout-gold px-6 font-semibold text-[#1d1606] hover:bg-sprout-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout-gold focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy"
          >
            Discuss an employer programme
          </Link>
        </div>
      </div>
    </Section>
  );
}

/* 11. Clinical oversight -------------------------------------------------- */

const COMMITMENTS = [
  { title: "Approved care rules", body: "Plans and result checks follow protocols our Chief Medical Officer signs." },
  { title: "Doctors decide", body: "Software organises your information. Clinical decisions are made by doctors." },
  { title: "Your consent first", body: "You decide who sees your information." },
  { title: "Not an emergency service", body: "If you are very unwell, go to the nearest hospital now." },
] as const;

export function HomeClinicalOversight() {
  return (
    <Section labelledBy="home-clinical-title">
      <div className="mb-10 grid max-w-3xl gap-3">
        <Eyebrow>Clinical oversight</Eyebrow>
        <Heading id="home-clinical-title">Technology, with doctors accountable for your care.</Heading>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {TEAM.map((m) => (
          <li key={m.id} className="flex items-center gap-4 rounded-2xl border border-mk-border bg-white p-4">
            {m.photoSrc ? (
              <Image
                src={m.photoSrc}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
            ) : null}
            <span className="grid min-w-0">
              <span className="font-semibold text-charcoal-ink">{m.name}</span>
              <span className="text-sm text-charcoal-ink/80">{m.title}</span>
              {m.credentials ? <span className="text-xs text-mk-muted">{m.credentials}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {COMMITMENTS.map((c) => (
          <li key={c.title} className="grid gap-1">
            <span className="font-semibold text-charcoal-ink">{c.title}</span>
            <span className="text-[15px] text-mk-muted">{c.body}</span>
          </li>
        ))}
      </ul>
      <p className="mt-8">
        <Link href={MARKETING_ROUTES.accountability} className={`inline-flex items-center gap-1 rounded-sm font-semibold text-brand-green hover:underline ${FOCUS}`}>
          How we are accountable <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </p>
    </Section>
  );
}
