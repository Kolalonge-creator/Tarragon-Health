import { describeRangeWithSource } from "@/lib/lab-results/structured";

type RangeItem = Parameters<typeof describeRangeWithSource>[0];

/** A reference-range cell: the range only when its source is known, always with the source line (S05b). */
export function RangeCell({ item, sourceClassName = "text-charcoal-ink/60" }: { item: RangeItem; sourceClassName?: string }) {
  const described = describeRangeWithSource(item);
  return (
    <>
      {described.range}
      <span className={`block text-xs ${sourceClassName}`}>{described.sourceLabel}</span>
    </>
  );
}
