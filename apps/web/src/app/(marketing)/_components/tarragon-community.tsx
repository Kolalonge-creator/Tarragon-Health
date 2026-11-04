import Link from "next/link";
import { LifeBuoy, ShieldCheck, UserRound } from "lucide-react";
import { COMMUNITY_GROUPS, COMMUNITY_NOTE, COMMUNITY_POINTS, COMMUNITY_SECTION } from "../_content/community";
import { Section } from "./section";

/**
 * "Tarragon Community": the patient support groups, for the home page. Server component, no platform/auth imports
 * (marketing rule). Copy and its mapping to live behaviour live in _content/community.ts.
 */
export function TarragonCommunity({ variant = "default", id = "community" }: { variant?: "default" | "sage"; id?: string }) {
  const headingId = `${id}-heading`;
  const icons = [UserRound, ShieldCheck, LifeBuoy];
  return (
    <Section id={id} variant={variant} labelledBy={headingId}>
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">{COMMUNITY_SECTION.eyebrow}</p>
        <h2 id={headingId} className="mt-2 font-heading text-3xl font-semibold leading-tight tracking-tight text-charcoal-ink sm:text-4xl">
          {COMMUNITY_SECTION.title}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/75">{COMMUNITY_SECTION.description}</p>
      </div>

      <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2" aria-label="Groups you can join" data-testid="community-groups">
        {COMMUNITY_GROUPS.map((name) => (
          <li key={name} className="rounded-full border border-brand-green/25 bg-brand-green/5 px-4 py-1.5 text-sm font-medium text-deep-forest">
            {name}
          </li>
        ))}
      </ul>

      <ul className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-3" data-testid="community-points">
        {COMMUNITY_POINTS.map((point, i) => {
          const Icon = icons[i] ?? ShieldCheck;
          return (
            <li key={point.title} className="rounded-2xl border border-charcoal-ink/10 bg-white p-6">
              <Icon aria-hidden className="h-5 w-5 text-brand-green" strokeWidth={1.8} />
              <p className="mt-3 font-heading text-base font-semibold text-charcoal-ink">{point.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{point.body}</p>
            </li>
          );
        })}
      </ul>

      <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-charcoal-ink/65">{COMMUNITY_NOTE}</p>
      <p className="mt-6 text-center">
        <Link
          href="/signup"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          Create a free account to join
        </Link>
      </p>
    </Section>
  );
}
