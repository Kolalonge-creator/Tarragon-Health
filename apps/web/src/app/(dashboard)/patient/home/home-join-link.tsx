"use client";

import Link from "next/link";
import { formatPatientDateTime } from "@/lib/format-date";
import { joinOpensAt, joinWindowState } from "@/lib/consultation/join-window";
import { useHalfMinuteClock } from "@/lib/consultation/use-half-minute-clock";

const UNDER_WAY = ["checked_in", "in_progress"];

/**
 * The join control on Home's next-appointment card. Same window as the appointments list (consultations.policy): nothing on the
 * server render, "You can join from…" before the window, a Join link inside it (or while the visit is under way). The link opens
 * the appointments page, where the call is started.
 */
export function HomeJoinLink({ scheduledFor, status }: { scheduledFor: string; status: string }) {
  const clock = useHalfMinuteClock();
  if (clock === null) return null;
  const state = joinWindowState(scheduledFor, new Date(clock));
  if (state === "open" || (state === "closed" && UNDER_WAY.includes(status))) {
    return (
      <Link
        href="/patient/appointments"
        className="inline-flex min-h-11 items-center rounded-lg bg-brand-green px-4 text-sm font-semibold text-white hover:bg-deep-forest"
      >
        Join consultation
      </Link>
    );
  }
  if (state === "too_early") {
    return (
      <span className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        You can join from{" "}
        {formatPatientDateTime(joinOpensAt(scheduledFor).toISOString(), { weekday: "short", hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  return null;
}
