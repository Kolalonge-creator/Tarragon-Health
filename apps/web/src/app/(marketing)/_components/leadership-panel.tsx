"use client";

import * as React from "react";
import Image from "next/image";
import { ArrowRight, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TEAM } from "../_content/leadership";

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

export function LeadershipGrid() {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const active = TEAM.find((m) => m.id === openId) ?? null;
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  // aria-modal tells assistive tech to ignore everything outside the dialog,
  // so focus must actually live inside it: move it in on open, keep Tab
  // cycling within, lock body scroll, and hand focus back to the card that
  // opened it on close.
  React.useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel
      ?.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")
      ?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenId(null);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        "button, [href], [tabindex]:not([tabindex='-1'])"
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [active]);

  return (
    <>
      <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {TEAM.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setOpenId(member.id);
            }}
            className="flex flex-col items-center rounded-2xl border border-charcoal-ink/10 bg-white p-6 text-center transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            {member.photoSrc ? (
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
                className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-soft-sage/60 text-deep-forest shadow-lg ring-2 ring-brand-green/30"
                role="img"
                aria-label={member.photoAlt ?? member.name}
              >
                <User className="h-8 w-8" strokeWidth={1.25} />
              </div>
            )}
            <span className="mt-3 inline-flex rounded-full bg-brand-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-deep-forest">
              {member.title}
            </span>
            <h3 className="mt-3 font-heading text-lg font-semibold text-charcoal-ink">
              {member.name}
            </h3>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-deep-forest">
              Meet {member.name.split(" ")[1] ?? member.name}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
            </span>
          </button>
        ))}
      </div>

      {active ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`About ${active.name}`}>
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-charcoal-ink/50"
            onClick={() => setOpenId(null)}
          />
          <div
            ref={panelRef}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-charcoal-ink/10 px-6 py-4">
              <p className="text-sm font-medium uppercase tracking-wide text-charcoal-ink/70">
                About {active.name.split(" ")[1] ?? active.name}
              </p>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className={cn(
                  "rounded-full p-1.5 text-charcoal-ink/70 transition-colors hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
                )}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 px-6 py-8">
              {active.photoSrc ? (
                <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-white shadow-lg ring-2 ring-brand-green/30">
                  <Image
                    src={active.photoSrc}
                    alt={active.photoAlt ?? active.name}
                    width={224}
                    height={224}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div
                  className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-white bg-soft-sage/60 text-deep-forest shadow-lg ring-2 ring-brand-green/30"
                  role="img"
                  aria-label={active.photoAlt ?? active.name}
                >
                  <User className="h-11 w-11" strokeWidth={1.25} />
                </div>
              )}
              <h2 className="mt-5 font-heading text-2xl font-semibold text-charcoal-ink">
                {active.name}
              </h2>
              <p className="mt-1 text-sm font-medium text-charcoal-ink/70">{active.title}</p>
              {active.credentials ? (
                <p className="mt-1 text-xs uppercase tracking-wide text-charcoal-ink/70">
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
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
