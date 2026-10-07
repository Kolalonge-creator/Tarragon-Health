import { RECHECK_WITH_FINGERTIP_OXIMETER, sourceBadgeLabel } from "@tarragon/shared";

/**
 * Where a reading came from, on every reading in every list (S70a, 18.9). A typed value, a Bluetooth device, a watch or wearable, a glucose
 * sensor and a photo the person checked each read differently, so nobody mistakes a wrist estimate for a fingertip test (53.9). The words
 * come from one place, `sourceBadgeLabel` in the shared package, so web and phone say the same thing.
 */
export function SourceBadge({ source }: { source: string | null | undefined }) {
  return (
    <span
      data-testid="source-badge"
      className="ml-2 inline-block rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-[11px] font-medium text-charcoal-ink/60 dark:bg-night-ink/15 dark:text-night-ink/60"
    >
      {sourceBadgeLabel(source)}
    </span>
  );
}

/**
 * An oxygen reading from a wrist or watch sensor can be less accurate, so the person is asked to check again with a fingertip oximeter
 * (A12). Shown under the reading itself, for any SpO2 that arrived through a wearable or a phone health bridge.
 */
export function WristSpo2Note({ source, vitalType }: { source: string | null | undefined; vitalType: string }) {
  if (vitalType !== "spo2" || source !== "wearable") return null;
  return (
    <p data-testid="wrist-spo2-note" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
      {RECHECK_WITH_FINGERTIP_OXIMETER}
    </p>
  );
}
