/** Signature continuity visual, echoes Guard Leaf checkmark vein (docs/MARKETING_SITE_SPEC.md §1). */

const MOMENTS = [
  { label: "Reading", cx: 32, cy: 50 },
  { label: "Reminder", cx: 112, cy: 32 },
  { label: "Clinician call", cx: 208, cy: 38 },
  { label: "Family update", cx: 312, cy: 40 },
] as const;

export function ContinuityPath() {
  return (
    <div className="relative mx-auto mt-10 max-w-2xl" aria-hidden>
      <svg
        viewBox="0 0 400 80"
        className="h-20 w-full text-brand-green/40 motion-safe:opacity-0 motion-safe:[animation:marketing-fade-in_1s_ease-out_0.2s_forwards]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M20 50 C 80 20, 120 70, 180 45 S 280 15, 380 40"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {MOMENTS.map(({ cx, cy }) => (
          <circle key={cx} cx={cx} cy={cy} r="5" className="fill-brand-green/70" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-charcoal-ink/70">
        {MOMENTS.map(({ label }) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
