/** What Tarragon stands for, grounded in real practice, docs/BRAND_GUIDE.md §3. */

const PILLARS = [
  {
    title: "Clinically reviewed",
    body: "Real doctors review your readings and results against care protocols, rather than an algorithm acting alone.",
  },
  {
    title: "Personal, not automated",
    body: "You have a care team who know your name and follow up with you personally.",
  },
  {
    title: "Calm, early follow-up",
    body: "We notice changes early and contact you calmly, so that a small change receives attention before it becomes a crisis.",
  },
  {
    title: "Explained in plain language",
    body: "We explain what a result means and what to do next in clear words, so that you know what is happening.",
  },
  {
    title: "High quality, within reach",
    body: "Consistent, high-quality care that stays affordable, built for people across Nigeria rather than a select few.",
  },
  {
    title: "Built for Nigeria",
    body: "Based on how care works in Nigeria, from the local pharmacy to the laboratory across town.",
  },
] as const;

/** Honest commitments, positively framed (avoids the curt-negative marketing tone). */
const COMMITMENTS = [
  "Calm, measured language, with no scare tactics",
  "Clear, upfront pricing with no hidden costs",
  "Honest about what we can and cannot do",
  "We support your hospital rather than replace it",
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
        {COMMITMENTS.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-2 rounded-full border border-charcoal-ink/10 bg-white px-4 py-2 text-xs font-medium text-charcoal-ink/70"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand-green" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
