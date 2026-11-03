"use client";

import { usePathname } from "next/navigation";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * The "Hi, Amaka / Patient dashboard" greeting at the top of the patient sections.
 *
 * It used to be stamped by the sections layout on every routed section (Vitals, Medications, Labs, Prevention, Profile...), so
 * each of those pages opened with the greeting block AND its own titled header, about 120px of repeated chrome before any
 * content, on every page (design audit S1/S2). The greeting belongs to the Overview; here it draws only on `/patient` itself.
 * Every other section keeps a visually hidden h1 so the page outline still starts at one.
 *
 * A client component only because the pathname is what decides; everything it draws is plain markup.
 */
export function SectionGreeting({ greeting, roleLabel }: { greeting: string; roleLabel: string }) {
  const pathname = usePathname();
  const onOverview = pathname === "/patient" || pathname === "/patient/";
  if (!onOverview) {
    return <h1 className="sr-only">{`${roleLabel} dashboard`}</h1>;
  }
  const Icon = SEMANTIC_ICON.preventive;
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-soft-sage dark:bg-brand-green/20">
        <Icon className="h-6 w-6 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
      </span>
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink dark:text-night-ink sm:text-3xl">
          {greeting}
        </h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{roleLabel} dashboard</p>
      </div>
    </div>
  );
}
