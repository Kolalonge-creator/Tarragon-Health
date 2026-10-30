"use client";

import { useVitalsReadings } from "@/lib/queries/vitals";
import { buildLatestBpHero } from "@/lib/vitals/latest-bp-hero";
import { HeroMetric } from "@/components/ui/hero-metric";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SEMANTIC_ICON } from "@/lib/icons";

const CHIP: Record<"green" | "amber" | "red" | "emergency", "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red",
  emergency: "red",
};

/**
 * The first thing on Vitals: the latest blood pressure as the largest element on the page, its status in words, when it was taken and
 * the 7-day average. Web twin of the mobile Vitals hero (docs/design/DESIGN-PHASE-1-VITALS.md). Reads through the same audited hook as
 * the history below, so a refusal shows as an error, never as "no readings".
 */
export function LatestBpHero({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useVitalsReadings(patientId);

  if (isLoading) return <Skeleton className="h-44 w-full rounded-2xl" />;
  if (isError) return null; // the history card below already reports the failure; no second alarm here
  const hero = buildLatestBpHero(data ?? []);

  if (!hero) {
    return (
      <div className="rounded-2xl bg-white dark:bg-night-card">
        <EmptyState
          icon={SEMANTIC_ICON.bp}
          title="No readings yet"
          body="Log your first blood pressure below. It takes under a minute."
          action={<Button asChild><a href="#log-reading">Log a reading</a></Button>}
        />
      </div>
    );
  }

  const when = new Date(hero.takenAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <HeroMetric
      label="Latest blood pressure"
      value={`${hero.systolic}/${hero.diastolic}`}
      unit="mmHg"
      status={hero.status ? { label: hero.status.word, variant: CHIP[hero.status.level] } : undefined}
      meta={
        <>
          {when}
          {hero.average && ` · 7-day average ${hero.average.systolic}/${hero.average.diastolic} (${hero.average.count} ${hero.average.count === 1 ? "reading" : "readings"})`}
        </>
      }
    />
  );
}
