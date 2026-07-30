/**
 * Standing, always-visible support note for mental-health content (mirrors
 * EmergencyNotice's calm, non-fear-based pattern). Shown regardless of the
 * wellbeing check's result, not gated behind a "low score" — the check asks
 * nothing about self-harm, so this is the actual safety net.
 *
 * Numbers are real, publicly published Nigerian services, not invented:
 * She Writes Woman's toll-free line (reported by Nigeria Health Watch) and
 * the national emergency number. If either is ever discontinued or changed,
 * update here rather than removing the note entirely.
 */
export function MentalHealthSupportNotice({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={`mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/70 px-6 py-5 text-center ${className ?? ""}`}
    >
      <p className="font-heading text-base font-semibold text-red-800">
        If you need to talk to someone right now
      </p>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">
        Call She Writes Woman&apos;s toll-free helpline on{" "}
        <a href="tel:08008002000" className="font-medium underline">
          0800 800 2000
        </a>{" "}
        for free, confidential counselling, or call{" "}
        <a href="tel:112" className="font-medium underline">
          112
        </a>{" "}
        for Nigeria&apos;s national emergency line. If you or someone you&apos;re with is in
        immediate danger, go to the nearest emergency department right away.
      </p>
    </div>
  );
}
