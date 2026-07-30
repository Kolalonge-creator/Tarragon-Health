import type { Metadata } from "next";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { loadImpactMetrics } from "@/lib/marketing/impact-data";

export const metadata: Metadata = {
  title: "Our impact: TarragonHealth",
  description:
    "Platform-wide numbers on what TarragonHealth's monitoring and doctor review actually catches, updated daily, with small numbers held back to protect patient privacy.",
};

// The underlying table refreshes on a nightly cron; re-render at the same cadence.
export const revalidate = 300;

function formatValue(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-NG").format(value);
}

export default async function ImpactPage() {
  const metrics = await loadImpactMetrics();
  const anyVisible = metrics.some((m) => !m.suppressed && m.value !== null);
  const computedAt = metrics.find((m) => m.computedAt)?.computedAt ?? null;

  return (
    <>
      <Section className="pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">Our impact</h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Real, platform-wide counts of what monitoring and doctor review actually catch: not a
            claims feed, not a sales pitch. Refreshed daily.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Platform-wide"
          title={anyVisible ? "What the numbers show" : "We're just getting started"}
          description={
            anyVisible
              ? "Every figure below is a real count from the platform, aggregated across every patient, institution and city, never broken down by organisation or individual."
              : "TarragonHealth is early. We hold back any number small enough that showing it could identify a real person, so most figures here will fill in as more patients join. That's a privacy choice, not a bug."
          }
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((metric) => (
            <div
              key={metric.metricKey}
              className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <p className="font-heading text-3xl font-semibold text-brand-green">
                {formatValue(metric.value)}
              </p>
              <p className="mt-2 text-sm font-medium text-charcoal-ink">{metric.label}</p>
              {metric.description && (
                <p className="mt-1 text-xs text-charcoal-ink/60">{metric.description}</p>
              )}
              {metric.suppressed && (
                <p className="mt-2 text-xs text-charcoal-ink/50">
                  Not enough activity yet to show without risking anyone&apos;s privacy.
                </p>
              )}
            </div>
          ))}
        </div>
        {computedAt && (
          <p className="mx-auto mt-6 max-w-4xl text-center text-xs text-charcoal-ink/50">
            Last updated {new Date(computedAt).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            . Any figure under 25 is held back rather than shown, whatever it is.
          </p>
        )}
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-heading text-2xl font-semibold text-charcoal-ink">
            How we protect privacy in these numbers
          </h2>
          <p className="mt-4 text-charcoal-ink/70">
            Nothing here is broken down by employer, HMO, hospital or any other group smaller than
            the whole platform. That&apos;s a stricter rule than we apply even to an institution
            looking at its own aggregate data. Any count below 25 is held back entirely rather than
            shown as a small, potentially identifying number.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <CtaBand
          variant="gradient"
          title="Be part of the next number"
          description="Every figure above started with one person choosing to get monitored properly."
          primaryHref="/signup"
          primaryLabel="Start free"
          secondaryHref="/services"
          secondaryLabel="See how it works"
        />
      </Section>
    </>
  );
}
