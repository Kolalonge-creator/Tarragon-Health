/** Voice personality pillars, docs/BRAND_GUIDE.md §3. */

const PILLARS = [
  { title: "Trustworthy", body: "Clinically credible, protocol-driven. We earn trust; we don't claim it." },
  { title: "Warm", body: "A clinician who knows your name, not a hospital PA system." },
  { title: "Calm", body: "We notice things early and say so calmly, never alarmist." },
  { title: "Intelligent", body: "We explain an HbA1c result in one clear sentence, never patronise." },
  { title: "Premium but accessible", body: "High quality without feeling elitist. Well within reach." },
  { title: "Nigerian-relevant", body: "Our examples are always local: the market BP cuff, garri, the family WhatsApp group." },
] as const;

const NEVER_DO = [
  "No fear-based urgency",
  "No hidden costs, ever",
  "No “guaranteed” outcomes",
  "Never replaces your hospital",
] as const;

export function TrustPillars() {
  return (
    <div>
      <div className="grid gap-px overflow-hidden rounded-2xl bg-charcoal-ink/10 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((pillar) => (
          <div
            key={pillar.title}
            className="relative bg-white p-7 transition-transform duration-300 hover:z-10 hover:-translate-y-1 hover:shadow-lg"
          >
            <h3 className="font-heading text-base font-semibold text-charcoal-ink">{pillar.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{pillar.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {NEVER_DO.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-2 rounded-full border border-charcoal-ink/10 bg-white px-4 py-2 text-xs font-medium text-charcoal-ink/70"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-charcoal-ink/40" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
