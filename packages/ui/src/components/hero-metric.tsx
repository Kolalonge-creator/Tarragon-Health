import * as React from "react";
import { cn } from "../utils";
import { Badge, type BadgeProps } from "./badge";

/**
 * The one big number on a metric screen: the latest reading, its unit, a
 * status chip and one plain sentence. Web twin of the mobile hero reading
 * (apps/mobile Vitals), so a patient meets the same shape on both surfaces.
 *
 * Status colour is the clinical system (green/amber/red), never a brand
 * colour, and the chip always carries a word so colour is never the only cue.
 * Pass `value={null}` before a first reading to get the empty prompt instead
 * of a fake number.
 */
export function HeroMetric({
  label,
  value,
  unit,
  status,
  caption,
  meta,
  emptyText,
  className,
}: {
  label: string;
  value: React.ReactNode | null;
  unit?: string;
  status?: { label: string; variant: NonNullable<BadgeProps["variant"]> };
  /** One plain sentence under the number. */
  caption?: React.ReactNode;
  /** Small secondary line, e.g. when it was taken and the 7-day average. */
  meta?: React.ReactNode;
  emptyText?: string;
  className?: string;
}) {
  return (
    <section aria-label={label} className={cn("space-y-2 rounded-2xl bg-white p-5 dark:bg-night-card sm:p-6", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{label}</p>
      {value === null ? (
        <p className="max-w-sm text-sm text-charcoal-ink/70 dark:text-night-ink/70">{emptyText ?? "No reading yet."}</p>
      ) : (
        <>
          {/* Proportional figures on purpose: display numbers never use tabular-nums. */}
          <p className="font-heading text-5xl font-semibold text-charcoal-ink dark:text-night-ink sm:text-6xl">
            {value}
            {unit && <span className="ml-1.5 align-baseline text-lg font-normal text-charcoal-ink/60 dark:text-night-ink/60">{unit}</span>}
          </p>
          {status && <Badge variant={status.variant}>{status.label}</Badge>}
          {caption && <p className="max-w-md text-sm text-charcoal-ink/80 dark:text-night-ink/80">{caption}</p>}
          {meta && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{meta}</p>}
        </>
      )}
    </section>
  );
}
