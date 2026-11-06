"use client";

import { usePathname } from "next/navigation";
import { SEMANTIC_ICON } from "@/lib/icons";
import { getLagosGreetingWord } from "@/lib/greeting";

/**
 * The "Hi, Amaka / Patient dashboard" greeting at the top of the patient sections.
 *
 * It used to be stamped by the sections layout on every routed section (Vitals, Medications, Labs, Prevention, Profile...), so
 * each of those pages opened with the greeting block AND its own titled header, about 120px of repeated chrome before any
 * content, on every page (design audit S1/S2). The greeting belongs to the Overview; here it draws only on `/patient` itself.
 * Every other section keeps a visually hidden h1 so the page outline still starts at one.
 *
 * It is Home's one greeting (spec 4.1, PD-05): "Good evening, Amaka" on Lagos time, then "Your health journey, all in one place."
 * Home used to say hello twice, once here ("Hi, Amaka / Patient dashboard") and again inside the first card.
 *
 * A client component because the pathname decides, and so the time of day is worked out on each render: the sections layout
 * is not re-rendered as the patient moves between pages, so a greeting computed there would still say "morning" at night.
 */
export function SectionGreeting({
  firstName,
  actingFor = null,
  roleLabel,
  badge = null,
}: {
  firstName: string | null;
  /** The name of the person whose account is open, while acting for them. */
  actingFor?: string | null;
  roleLabel: string;
  badge?: React.ReactNode;
}) {
  const pathname = usePathname();
  const onOverview = pathname === "/patient" || pathname === "/patient/";
  if (!onOverview) {
    return <h1 className="sr-only">{`${roleLabel} dashboard`}</h1>;
  }
  const Icon = SEMANTIC_ICON.preventive;
  const word = getLagosGreetingWord();
  const greeting = actingFor !== null ? `${actingFor || "Their"}'s account` : `Good ${word}${firstName ? `, ${firstName}` : ""}`;
  const subtitle = actingFor !== null ? `You are looking after ${actingFor ? `${actingFor}'s` : "their"} health.` : "Your health journey, all in one place.";
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-soft-sage dark:bg-brand-green/20">
        <Icon className="h-6 w-6 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
      </span>
      <div>
        {/* The hour can differ between the server render and the browser at a boundary (11:59 vs 12:00). */}
        <h1
          suppressHydrationWarning
          className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink dark:text-night-ink sm:text-3xl"
        >
          {greeting}
        </h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{subtitle}</p>
        {badge ? <div className="mt-2">{badge}</div> : null}
      </div>
    </div>
  );
}
