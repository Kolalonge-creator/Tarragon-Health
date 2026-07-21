/** What Tarragon stands for, grounded in real practice, docs/BRAND_GUIDE.md §3. */

const PILLARS = [
  {
    title: "Clinically reviewed",
    body: "Real doctors review your readings and results against care protocols, never an algorithm acting alone.",
  },
  {
    title: "Warm, not automated",
    body: "You get a care team who knows your name and follows up like a person, not a hospital PA system.",
  },
  {
    title: "Calm, early follow-up",
    body: "We notice things early and reach out calmly, so a small change gets attention before it becomes a crisis.",
  },
  {
    title: "Explained in plain language",
    body: "We tell you what a result means and what to do next in clear words, so you are never left guessing.",
  },
  {
    title: "Premium, within reach",
    body: "High-quality, consistent care that stays affordable, built for Nigerians rather than a select few.",
  },
  {
    title: "Built for Nigeria",
    body: "Grounded in how care really works here, from the pharmacy down the road to the lab across town.",
  },
] as const;

/** Honest commitments, positively framed (avoids the curt-negative marketing tone). */
const COMMITMENTS = [
  "No fear-based urgency, ever",
  "Clear, upfront pricing with no hidden costs",
  "Honest about what we can and can't do",
  "We support your hospital, never replace it",
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
