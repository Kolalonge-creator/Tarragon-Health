/**
 * Standing, always-visible support note for mental-health content (mirrors
 * EmergencyNotice's calm, non-fear-based pattern). Shown regardless of the
 * wellbeing check's result, not gated behind a "low score" — the check asks
 * nothing about self-harm, so this is the actual safety net.
 *
 * The helpline number is a real, publicly published Nigerian service, not
 * invented: She Writes Woman's toll-free line (reported by Nigeria Health
 * Watch). If it is ever discontinued or changed, update here rather than
 * removing the note entirely. No emergency-line number is quoted — Nigeria
 * has no single reliable one to call, so immediate danger is always routed
 * to the nearest hospital in person, matching the pattern used everywhere
 * else emergency guidance is shown (see emergency-alert.tsx).
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
        for free, confidential counselling. If you or someone you&apos;re with is in immediate
        danger, go to the nearest hospital right away.
      </p>
    </div>
  );
}
