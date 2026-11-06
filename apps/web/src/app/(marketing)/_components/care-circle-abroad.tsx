import Link from "next/link";
import { CalendarDays, Check, Eye, Gift, PauseCircle, Phone, UserPlus } from "lucide-react";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { cn } from "@/lib/utils";
import {
  CARE_CIRCLE_ABROAD,
  CARE_CIRCLE_CONTROL,
  CARE_CIRCLE_GIFT,
  CARE_CIRCLE_ILLUSTRATION,
  CARE_CIRCLE_SHARED,
} from "../_content/care-circle";
import { Section } from "./section";

/**
 * "Care Circle for family abroad": a section for the home page and /parentcare. Server component, no platform/auth
 * imports, no price (the gift link goes to /gift, which reads it from config). Copy and its live-feature mapping live
 * in _content/care-circle.ts.
 *
 * The product visual is a hand-built mock of the supporter view, labelled "Illustration", with a made-up name and
 * numbers. Motion is limited to the chart line and the doses ring drawing in once (the `cc-draw` class in
 * globals.css), and only when the visitor has not asked for reduced motion; without it the visual is simply complete.
 */
export function CareCircleAbroad({ variant = "default", id = "care-circle" }: { variant?: "default" | "sage"; id?: string }) {
  const headingId = `${id}-heading`;
  return (
    <Section id={id} variant={variant} className="py-20 sm:py-28" labelledBy={headingId}>
      <div className="grid items-start gap-x-20 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="max-w-xl">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-deep-forest">{CARE_CIRCLE_ABROAD.eyebrow}</p>
          <h2 id={headingId} className="mt-3 font-heading text-3xl font-semibold leading-tight tracking-tight text-charcoal-ink sm:text-[2.75rem]">
            {CARE_CIRCLE_ABROAD.title}
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-charcoal-ink/75">{CARE_CIRCLE_ABROAD.description}</p>
        </div>

        {/* One copy of the visual: after the introduction on a phone, beside the text (and sticky) on a wide screen. */}
        <div className="lg:sticky lg:top-28 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <SupporterViewIllustration />
        </div>

        <div className="max-w-xl">
          <h3 className="font-heading text-lg font-semibold text-charcoal-ink">With their permission, you can see</h3>
          <ul className="mt-5 divide-y divide-charcoal-ink/10 border-y border-charcoal-ink/10" data-testid="care-circle-shared">
            {CARE_CIRCLE_SHARED.map((item) => (
              <li key={item.title} className="flex gap-4 py-4">
                <span aria-hidden className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                <div>
                  <p className="font-medium text-charcoal-ink">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="mt-12 font-heading text-lg font-semibold text-charcoal-ink">They stay in charge</h3>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3" data-testid="care-circle-control">
            {CARE_CIRCLE_CONTROL.map((item, i) => {
              const Icon = [UserPlus, PauseCircle, Eye][i] ?? Check;
              return (
                <li key={item.title} className="rounded-2xl border border-charcoal-ink/10 bg-white p-5">
                  <Icon aria-hidden className="h-5 w-5 text-brand-green" strokeWidth={1.8} />
                  <p className="mt-3 text-sm font-semibold text-charcoal-ink">{item.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
                </li>
              );
            })}
          </ul>

          <div className="mt-10 flex gap-4 rounded-2xl bg-warm-ivory p-5 ring-1 ring-sprout-gold/25 sm:p-6">
            <Gift aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-deep-forest" strokeWidth={1.8} />
            <div>
              <p className="font-medium text-charcoal-ink">{CARE_CIRCLE_GIFT.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/70">{CARE_CIRCLE_GIFT.body}</p>
              <Link
                href={MARKETING_ROUTES.gift}
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
              >
                {CARE_CIRCLE_GIFT.linkLabel}
              </Link>
            </div>
          </div>

        </div>
      </div>
    </Section>
  );
}

const CHART = { w: 280, h: 104, left: 8, right: 8, top: 10, bottom: 22, min: 78, max: 146 } as const;

function chartPoint(i: number, value: number, count: number) {
  const x = CHART.left + (i * (CHART.w - CHART.left - CHART.right)) / (count - 1);
  const y = CHART.top + ((CHART.max - value) / (CHART.max - CHART.min)) * (CHART.h - CHART.top - CHART.bottom);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function linePath(values: readonly number[]) {
  return values
    .map((v, i) => {
      const p = chartPoint(i, v, values.length);
      return `${i === 0 ? "M" : "L"}${p.x} ${p.y}`;
    })
    .join(" ");
}

/** A crafted mock of what a Care Circle member sees. Every block mirrors a block of the live supporter view. */
export function SupporterViewIllustration({ className }: { className?: string }) {
  const d = CARE_CIRCLE_ILLUSTRATION;
  const systolic = d.weeks.map((w) => w.systolic);
  const diastolic = d.weeks.map((w) => w.diastolic);
  const last = d.weeks[d.weeks.length - 1];
  const prev = d.weeks[d.weeks.length - 2];
  const percent = Math.round((d.dosesTaken / d.dosesDue) * 100);
  const lastPoint = chartPoint(d.weeks.length - 1, last.systolic, d.weeks.length);
  const lastDia = chartPoint(d.weeks.length - 1, last.diastolic, d.weeks.length);
  const direction =
    Math.abs(last.systolic - prev.systolic) <= 2 ? "About the same as the week before." : last.systolic < prev.systolic ? "Lower than the week before." : "Higher than the week before.";

  return (
    <figure className={cn("mx-auto w-full max-w-[26rem]", className)} data-testid="care-circle-illustration">
      <div className="relative rounded-[2rem] bg-gradient-to-b from-soft-sage to-warm-ivory p-3 shadow-[0_30px_60px_-30px_rgba(18,50,75,0.35)] ring-1 ring-charcoal-ink/5 sm:p-4">
        <div className="overflow-hidden rounded-[1.5rem] bg-white ring-1 ring-charcoal-ink/5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-charcoal-ink/5 px-5 pb-4 pt-5">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-deep-forest font-heading text-sm font-semibold text-white">
                {d.name.slice(0, 1)}
              </span>
              <div>
                <p className="font-heading text-base font-semibold leading-tight text-charcoal-ink">{d.name}</p>
                <p className="text-xs text-charcoal-ink/70">{d.sharedUntil}</p>
              </div>
            </div>
            <span className="rounded-full border border-charcoal-ink/15 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-charcoal-ink/70">
              Illustration
            </span>
          </div>

          <div className="space-y-3 p-4">
            {/* Weekly blood pressure averages */}
            <div className="rounded-2xl bg-warm-ivory/70 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-charcoal-ink">Blood pressure, weekly averages</p>
                <p className="whitespace-nowrap text-xs text-charcoal-ink/70">6 weeks</p>
              </div>
              <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} className="mt-3 h-auto w-full" aria-hidden focusable="false">
                {[90, 120, 140].map((g) => {
                  const y = chartPoint(0, g, 2).y;
                  return <line key={g} x1={CHART.left} x2={CHART.w - CHART.right} y1={y} y2={y} stroke="currentColor" className="text-charcoal-ink/10" strokeDasharray="2 4" />;
                })}
                <path d={linePath(systolic)} pathLength={1} strokeDasharray="1" strokeDashoffset={0} className="cc-draw" fill="none" stroke="var(--brand-green)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                <path d={linePath(diastolic)} pathLength={1} strokeDasharray="1" strokeDashoffset={0} className="cc-draw" fill="none" stroke="var(--clinical-navy)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={lastPoint.x} cy={lastPoint.y} r={4} fill="white" stroke="var(--brand-green)" strokeWidth={2.5} />
                <circle cx={lastDia.x} cy={lastDia.y} r={4} fill="white" stroke="var(--clinical-navy)" strokeWidth={2.5} />
                {d.weeks.map((w, i) =>
                  i % 2 === 1 || i === d.weeks.length - 1 ? null : (
                    <text key={w.label} x={chartPoint(i, 0, d.weeks.length).x} y={CHART.h - 4} fontSize="10" fill="currentColor" className="text-charcoal-ink/70" textAnchor={i === 0 ? "start" : "middle"}>
                      {w.label}
                    </text>
                  )
                )}
              </svg>
              <p className="mt-2 text-sm text-charcoal-ink">
                Week of {last.label}: <span className="font-semibold">{last.systolic} over {last.diastolic}</span>{" "}
                <span className="text-charcoal-ink/70">({d.latestReadings} readings)</span>
              </p>
              <p className="mt-0.5 text-xs text-charcoal-ink/70">{direction}</p>
              <p className="mt-2 flex gap-4 text-xs text-charcoal-ink/70">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded bg-brand-green" />Upper number</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded bg-clinical-navy" />Lower number</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Doses taken */}
              <div className="rounded-2xl bg-warm-ivory/70 p-4">
                <p className="text-sm font-semibold text-charcoal-ink">Medicines this week</p>
                <div className="mt-3 flex flex-col items-start gap-2">
                  <svg viewBox="0 0 64 64" className="h-14 w-14 shrink-0 -rotate-90" aria-hidden focusable="false">
                    <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" className="text-charcoal-ink/10" strokeWidth="7" />
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      fill="none"
                      stroke="var(--brand-green)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      pathLength={1}
                      strokeDasharray="1"
                      strokeDashoffset={1 - d.dosesTaken / d.dosesDue}
                      className="cc-draw"
                    />
                  </svg>
                  <p className="text-sm leading-snug text-charcoal-ink">
                    <span className="font-heading text-xl font-semibold">{d.dosesTaken}</span>
                    <span className="text-charcoal-ink/70"> of {d.dosesDue}</span>
                    <span className="block text-xs text-charcoal-ink/70">doses taken, {percent} percent</span>
                  </p>
                </div>
              </div>

              {/* Appointments */}
              <div className="rounded-2xl bg-warm-ivory/70 p-4">
                <p className="text-sm font-semibold text-charcoal-ink">Appointments</p>
                <CalendarDays aria-hidden className="mt-3 h-5 w-5 text-deep-forest" strokeWidth={1.8} />
                <p className="mt-2 text-xs leading-snug text-charcoal-ink">
                  Next: <span className="font-semibold">{d.nextAppointment}</span>
                </p>
                <p className="mt-1 text-xs text-charcoal-ink/70">Missed in the last 30 days: {d.missedLast30Days}</p>
              </div>
            </div>

            {/* Check-in request */}
            <div className="flex items-start gap-3 rounded-2xl border border-sprout-gold/40 bg-white p-4">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sprout-gold/15 text-deep-forest">
                <Phone className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-charcoal-ink">Please check on {d.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-charcoal-ink/70">
                  Please call {d.name} now. Tarragon Health asked the people in their Care Circle to check in.
                </p>
                <p className="mt-2 inline-flex min-h-8 items-center rounded-full bg-deep-forest px-3 text-xs font-semibold text-white">I called them</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-xs leading-relaxed text-charcoal-ink/70">
        An illustration of what a Care Circle member sees. The name, dates and numbers are examples. The check-in request appears only if one is sent.
      </figcaption>
    </figure>
  );
}
