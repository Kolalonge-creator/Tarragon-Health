"use client";

import * as React from "react";
import Image from "next/image";
import { ArrowRight, User, X } from "lucide-react";
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
 * click a card, a bio opens in a panel on the right. Open roles live on
 * their own /careers page, not here — this grid is people only. Add a
 * `person` entry here the moment a role is actually filled.
 */
type PersonMember = {
  kind: "person";
  id: string;
  name: string;
  title: string;
  credentials?: string;
  photoSrc?: string;
  photoAlt?: string;
  bio: string;
  quote?: string;
  linkedinUrl?: string;
};

type TeamMember = PersonMember;

const TEAM: TeamMember[] = [
  {
    kind: "person",
    id: "kola-longe",
    name: "Dr Kola Longe",
    title: "Founder & CEO",
    credentials: "MBChB · FEBEM · FRCEM · MSt (University of Cambridge)",
    photoSrc: "/marketing/founder-kola-longe.jpg",
    photoAlt: "Dr Kola Longe, Founder & CEO of TarragonHealth",
    bio: "A physician and healthcare leader with experience across Nigeria and the United Kingdom, Kola works at the intersection of clinical medicine, healthcare leadership, and technology. He earned his MBChB from Obafemi Awolowo University, Ile-Ife, and specialised in Emergency Medicine, becoming a Fellow of the Royal College of Emergency Medicine and a Fellow of the European Board of Emergency Medicine. He holds a Master of Studies in Clinical Medicine from the University of Cambridge, and is a certified Project Management Professional and Program Management Professional through the Project Management Institute, pairing clinical insight with structured programme delivery and organisational leadership. Through TarragonHealth, Kola is building a more proactive model of healthcare, one that closes the gap between doctor's appointments, where early warning signs are often missed and preventable conditions go unnoticed. Using technology, data, and patient-centred design, TarragonHealth connects prevention, early detection, and ongoing care, helping people identify risks earlier, reach the right care sooner, and stay engaged with their health over time. As Founder and CEO, Kola leads TarragonHealth's clinical strategy, product vision, and growth, keeping every product grounded in real clinical need while staying accessible, scalable, and commercially sustainable.",
    quote:
      "Healthcare should not begin and end with a doctor's appointment. At TarragonHealth, our mission is to close the gap between visits, helping people detect disease earlier, prevent avoidable illness, and take greater control of their health throughout their lives.",
    linkedinUrl: "https://www.linkedin.com/in/dr-kola-longe-408b15121/",
  },
  {
    kind: "person",
    id: "maxwell-dayok",
    name: "Dr Maxwell Dayok",
    title: "Chief Medical Officer",
    credentials: "MBBS · MPH · FMCFM · FRCEM",
    photoSrc: "/marketing/cmo-maxwell-dayok.jpg",
    photoAlt: "Dr Maxwell Dayok, Chief Medical Officer at TarragonHealth",
    bio: "Dr Maxwell Dayok is Chief Medical Officer at TarragonHealth, with over 20 years of clinical practice spanning Nigeria and the United Kingdom in Emergency Medicine, Family Medicine, and Public Health. He qualified with an MBBS from the University of Jos, Nigeria, and holds an MPH from Ahmadu Bello University. He is a Fellow of the Royal College of Emergency Medicine (FRCEM) and a Fellow of the West African College of Physicians in Family Medicine (FMCFM), and practises as a Consultant in Family Medicine. He also holds a Postgraduate Certificate in Medical and Healthcare Education from Anglia Ruskin University. Dr Dayok built his early career within Nigeria's healthcare system before relocating to the UK, giving him first-hand experience of both systems and the populations they serve. That range, acute care, primary care, and prevention, across two very different health economies, shapes his approach at TarragonHealth. As CMO, he provides clinical leadership and oversight across the organisation, working with the leadership and product teams to ensure TarragonHealth's products and strategies are safe, evidence-based, and centred on the patient. His focus: prevention, early detection, and continuity of care.",
    quote:
      "The future of healthcare is not simply about treating illness when it appears, but about identifying risk early, preventing disease where possible, and ensuring that every patient has access to timely, evidence-based care. At TarragonHealth, we are building a healthcare model that makes prevention and early intervention an integral part of everyday life.",
    linkedinUrl: "https://www.linkedin.com/in/pankyes-maxwell-dayok-88b727134/",
  },
  {
    kind: "person",
    id: "adefola-adetunbi",
    name: "Dr Adefola Adetunbi",
    title: "Head of Clinical Operations",
    credentials: "MBChB · MPH · Leadership & Management in Health",
    photoSrc: "/marketing/head-clinical-ops-adefola-adetunbi.jpg",
    photoAlt: "Dr Adefola Adetunbi, Head of Clinical Operations at TarragonHealth",
    bio: "Dr Adefola Adetunbi is a physician and healthcare leader serving as Head of Clinical Operations at TarragonHealth, with experience spanning clinical practice, public health, and service operations across Nigeria and the United Kingdom. He obtained his MBChB from Obafemi Awolowo University, Ile-Ife, and holds an MPH from York St John University, London, alongside Leadership and Management in Health training from the University of Washington. Having practised within both the Nigerian and UK healthcare systems, he brings a cross-system understanding of the clinical, operational, and patient-facing challenges that shape healthcare delivery in each. As Head of Clinical Operations, he builds and leads TarragonHealth's clinical delivery model: the frameworks for recruiting, onboarding, training, scheduling, supporting, and governing clinicians. He works with the leadership, clinical, and technology teams on protocols, review pathways, quality assurance, and automation, creating the infrastructure that lets TarragonHealth expand access to medical expertise without compromising clinical standards.",
    quote:
      "Healthcare innovation only matters when it improves care for real patients. Our responsibility at TarragonHealth is to build clinical systems that can scale across different healthcare environments while maintaining the quality, safety, and human judgement that patients deserve.",
    linkedinUrl: "https://www.linkedin.com/in/adefola-richmond-adetunbi-a85b14121/",
  },
];

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
              <p className="text-sm font-medium uppercase tracking-wide text-charcoal-ink/65">
                About {active.name.split(" ")[1] ?? active.name}
              </p>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className={cn(
                  "rounded-full p-1.5 text-charcoal-ink/65 transition-colors hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
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
              <p className="mt-1 text-sm font-medium text-charcoal-ink/60">{active.title}</p>
              {active.credentials ? (
                <p className="mt-1 text-xs uppercase tracking-wide text-charcoal-ink/65">
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
