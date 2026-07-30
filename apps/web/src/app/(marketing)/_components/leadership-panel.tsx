"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { cn } from "@/lib/utils";

function LinkedInGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.59 0 4.25 2.36 4.25 5.44v6.3zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

function LinkedInButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#0A66C2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2] focus-visible:ring-offset-2"
    >
      <LinkedInGlyph className="h-4 w-4" />
      Connect on LinkedIn
    </a>
  );
}

/**
 * TarragonHealth's team, styled after Function Health's leadership grid:
 * click a card, a bio (or role brief) opens in a panel on the right. Real
 * people and still-open seats share one grid/pattern — `kind` decides what
 * the card and panel show. Add a `person` entry here (not to a separate
 * list) the moment a role above is actually filled.
 */
type PersonMember = {
  kind: "person";
  id: string;
  name: string;
  title: string;
  credentials?: string;
  photoSrc: string;
  photoAlt?: string;
  bio: string;
  quote?: string;
  linkedinUrl?: string;
};

type OpenRoleMember = {
  kind: "role";
  id: string;
  title: string;
  teaser: string;
  scope: string;
};

type TeamMember = PersonMember | OpenRoleMember;

const TEAM: TeamMember[] = [
  {
    kind: "person",
    id: "kola-longe",
    name: "Dr Kola Longe",
    title: "Founder & CEO",
    credentials: "MBChB · FEBEM · FRCEM · MSt (University of Cambridge)",
    photoSrc: "/marketing/founder-kola-longe.jpg",
    photoAlt: "Dr Kola Longe, Founder & CEO of TarragonHealth",
    bio: "Over a decade of medical practice across Nigeria and the UK, paired with PMP and PgMP certification from the Project Management Institute. Kola founded TarragonHealth to bring that same rigour to the gap between doctor visits, leading clinical strategy and product direction so every patient's care stays protocol-driven, continuous, and never left to chance.",
    quote:
      "I've spent over a decade watching what happens between hospital visits, in the emergency department and beyond. TarragonHealth is my answer to that gap: care that doesn't stop when the appointment ends.",
    linkedinUrl: "https://www.linkedin.com/in/dr-kola-longe-408b15121/",
  },
  {
    kind: "role",
    id: "cmo",
    title: "Chief Medical Officer",
    teaser: "Owns clinical protocols and the escalation pathway",
    scope:
      "Owns clinical protocols and the four-level escalation pathway, and leads the doctor network as chronic disease and preventive screening scale together.",
  },
  {
    kind: "role",
    id: "head-clinical-ops",
    title: "Head of Clinical Operations",
    teaser: "Builds the clinical review model as we scale",
    scope:
      "Builds and leads the clinical review model: recruiting, training, and scheduling doctors, and helping design the protocols and automation that let TarragonHealth scale doctor coverage well beyond a traditional clinic, without cutting corners on review.",
  },
  {
    kind: "role",
    id: "head-engineering",
    title: "Head of Engineering",
    teaser: "Owns the platform and ML microservice",
    scope:
      "Owns the TypeScript platform and ML microservice, the system of record behind every reading, reminder, and escalation.",
  },
  {
    kind: "role",
    id: "head-partnerships",
    title: "Head of Partnerships",
    teaser: "Grows the lab, pharmacy, and specialist network",
    scope:
      "Grows and manages the lab, pharmacy, and specialist network that Care Coordination runs on.",
  },
  {
    kind: "role",
    id: "head-growth",
    title: "Head of Growth & Commercial",
    teaser: "Leads corporate wellness and HMO partnerships",
    scope:
      "Leads corporate wellness and HMO partnerships, turning the B2B & Institutional pipeline into revenue.",
  },
];

export function LeadershipGrid() {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const active = TEAM.find((m) => m.id === openId) ?? null;

  React.useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return (
    <>
      <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {TEAM.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => setOpenId(member.id)}
            className="flex flex-col items-center rounded-2xl border border-charcoal-ink/10 bg-white p-6 text-center transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            {member.kind === "person" ? (
              <div className="h-20 w-20 overflow-hidden rounded-full border-4 border-white shadow-lg ring-2 ring-brand-green/30">
                <Image
                  src={member.photoSrc}
                  alt={member.photoAlt ?? member.name}
                  width={160}
                  height={160}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-charcoal-ink/20 text-charcoal-ink/40"
                role="img"
                aria-label={`Placeholder for ${member.title}`}
              >
                <User className="h-7 w-7" strokeWidth={1.25} />
              </div>
            )}
            <span className="mt-3 inline-flex rounded-full bg-brand-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-deep-forest">
              {member.kind === "person" ? member.title : "Open role"}
            </span>
            <h3 className="mt-3 font-heading text-lg font-semibold text-charcoal-ink">
              {member.kind === "person" ? member.name : member.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              {member.kind === "person" ? member.title : member.teaser}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-deep-forest">
              {member.kind === "person" ? `Meet ${member.name.split(" ")[1] ?? member.name}` : "View this role"}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
            </span>
          </button>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label={active.kind === "person" ? `About ${active.name}` : `About the ${active.title} role`}
        >
          <button
            aria-label="Close"
            className="absolute inset-0 bg-charcoal-ink/50"
            onClick={() => setOpenId(null)}
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-charcoal-ink/10 px-6 py-4">
              <p className="text-sm font-medium uppercase tracking-wide text-charcoal-ink/50">
                {active.kind === "person" ? `About ${active.name.split(" ")[1] ?? active.name}` : "Open role"}
              </p>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className={cn(
                  "rounded-full p-1.5 text-charcoal-ink/50 transition-colors hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
                )}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 px-6 py-8">
              {active.kind === "person" ? (
                <>
                  <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-white shadow-lg ring-2 ring-brand-green/30">
                    <Image
                      src={active.photoSrc}
                      alt={active.photoAlt ?? active.name}
                      width={224}
                      height={224}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <h2 className="mt-5 font-heading text-2xl font-semibold text-charcoal-ink">
                    {active.name}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-charcoal-ink/60">{active.title}</p>
                  {active.credentials ? (
                    <p className="mt-1 text-xs uppercase tracking-wide text-charcoal-ink/40">
                      {active.credentials}
                    </p>
                  ) : null}
                  <p className="mt-5 leading-relaxed text-charcoal-ink/70">{active.bio}</p>
                  {active.quote ? (
                    <blockquote className="mt-6 rounded-xl border-l-4 border-brand-green bg-soft-sage/60 px-5 py-4 italic leading-relaxed text-charcoal-ink/80">
                      &ldquo;{active.quote}&rdquo;
                    </blockquote>
                  ) : null}
                  {active.linkedinUrl ? <LinkedInButton href={active.linkedinUrl} /> : null}
                </>
              ) : (
                <>
                  <span className="inline-flex rounded-full bg-brand-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-deep-forest">
                    Open role
                  </span>
                  <h2 className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
                    {active.title}
                  </h2>
                  <p className="mt-5 leading-relaxed text-charcoal-ink/70">{active.scope}</p>
                  <p className="mt-5 text-sm leading-relaxed text-charcoal-ink/60">
                    This is one of the seats we&rsquo;re building out as TarragonHealth grows
                    past one founder. No one&rsquo;s in it yet, so if it sounds like you, we&rsquo;d
                    like to hear from you.
                  </p>
                  <Button asChild className="mt-6">
                    <Link href={`${MARKETING_ROUTES.contact}?source=careers`}>Get in touch</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
