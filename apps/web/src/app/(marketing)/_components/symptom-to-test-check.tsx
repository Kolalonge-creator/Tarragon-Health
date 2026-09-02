"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EmergencyNotice } from "./emergency-notice";
import {
  matchSymptomClusters,
  SYMPTOM_OPTIONS,
  type SymptomCluster,
} from "@/lib/symptom-check/symptom-clusters";

/**
 * Public, anonymous symptom-to-test checker. Nothing here is stored or sent
 * anywhere — matching happens entirely in the browser against a short,
 * pre-approved list of clusters (lib/symptom-check/symptom-clusters.ts).
 * This is deliberately not a diagnosis: a doctor-consult option is always
 * shown alongside any test suggestion, and any danger symptom suppresses
 * every suggestion in favour of EmergencyNotice.
 */
export function SymptomToTestCheck() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setSelected(new Set());
    setSubmitted(false);
  }

  if (submitted) {
    const { dangerFlag, matched } = matchSymptomClusters([...selected]);

    if (dangerFlag) {
      return (
        <div className="mx-auto max-w-2xl space-y-6">
          <EmergencyNotice />
          <div className="text-center">
            <button
              type="button"
              onClick={reset}
              className="text-sm font-medium text-charcoal-ink/70 underline-offset-4 hover:underline"
            >
              Start over
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {matched.length === 0 ? (
          <ResultCard
            title="Not sure what this points to"
            body="What you've described doesn't clearly match one of the specific patterns we check for here. That doesn't mean it's nothing — a doctor is the right next step to look at it properly."
          />
        ) : (
          matched.map((cluster) => <ClusterResultCard key={cluster.id} cluster={cluster} />)
        )}
        <div className="text-center">
          <button
            type="button"
            onClick={reset}
            className="text-sm font-medium text-charcoal-ink/70 underline-offset-4 hover:underline"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm leading-relaxed text-charcoal-ink/70">
        Tick anything you&apos;ve been noticing lately. This isn&apos;t a diagnosis, just a
        starting point.
      </p>
      <fieldset className="mt-6">
        <legend className="sr-only">Symptoms</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SYMPTOM_OPTIONS.map((option) => {
            const isSelected = selected.has(option.id);
            return (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm transition-colors",
                  isSelected
                    ? "border-brand-green bg-brand-green/5 text-charcoal-ink"
                    : "border-charcoal-ink/10 text-charcoal-ink/75 hover:border-charcoal-ink/25"
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-green"
                  checked={isSelected}
                  onChange={() => toggle(option.id)}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-xs text-charcoal-ink/50">{selected.size} selected</p>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => setSubmitted(true)}
          className={cn(
            "inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
            selected.size > 0
              ? "bg-brand-green text-white hover:bg-deep-forest"
              : "cursor-not-allowed bg-charcoal-ink/10 text-charcoal-ink/40"
          )}
        >
          See my suggestion
        </button>
      </div>
    </div>
  );
}

function ClusterResultCard({ cluster }: { cluster: SymptomCluster }) {
  return (
    <div className="rounded-2xl border-2 border-brand-green bg-brand-green/5 p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Suggested next step
      </p>
      <h3 className="mt-1 font-heading text-2xl font-semibold text-charcoal-ink">{cluster.name}</h3>
      <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/75">{cluster.patientExplanation}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded-full bg-brand-green px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-deep-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          Request this test
        </Link>
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded-full border border-charcoal-ink/15 px-5 py-2.5 text-sm font-medium text-charcoal-ink transition-colors hover:border-charcoal-ink/30"
        >
          Talk to a doctor first
        </Link>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/50">
        Sign up to actually request this or book a consultation — nothing here is a diagnosis,
        and nothing you answered was saved or sent anywhere.
      </p>
    </div>
  );
}

function ResultCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border-2 border-charcoal-ink/15 bg-soft-sage p-6 sm:p-8">
      <h3 className="font-heading text-xl font-semibold text-charcoal-ink">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/75">{body}</p>
      <div className="mt-6">
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded-full bg-brand-green px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-deep-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          Talk to a doctor
        </Link>
      </div>
    </div>
  );
}
