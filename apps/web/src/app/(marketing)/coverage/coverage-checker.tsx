"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SERVICE_LABEL, gatedServices, itemsFor } from "@/lib/coverage/what-works-where";
import { NIGERIA_ZONES } from "@/lib/nigeria-zones";
import type { StateCoverage } from "@/lib/marketing/coverage-data";
import { cn } from "@/lib/utils";

/**
 * "Does any of this work where my mother lives?", answered before signing up.
 *
 * Lab tests are partner-fulfilled again as of 2026-08-25 — Synlab Nigeria is a
 * real, signed, nationwide lab partner, so "lab" carries a gatedBy value in
 * @/lib/coverage/what-works-where and is tracked here like any other partner
 * service. Because Synlab is contracted in every state, lab tests read as
 * live everywhere today. Home sample collection and medication delivery still
 * depend on a contracted logistics partner (gatedServices() reflects that —
 * see @/lib/coverage/what-works-where) and neither is live in any state yet.
 * Pharmacy collection and specialist referrals are self-arranged and work
 * nationwide regardless of any partner, so they stay outside this gated list;
 * that is a fine thing to be honest about and a terrible thing to discover
 * after paying, which until now was the only way to discover it: the gate was
 * authenticated-only.
 *
 * The list is rendered from the same predicate the app itself enforces, so this
 * page cannot promise something the product will then refuse.
 */
export function CoverageChecker({ coverage }: { coverage: StateCoverage[] }) {
  const [state, setState] = useState<string>("");

  const selected = useMemo(
    () => coverage.find((row) => row.state === state) ?? null,
    [coverage, state]
  );

  const services = gatedServices();
  const anywhere = itemsFor("anywhere");

  const liveCount = selected ? services.filter((s) => selected.services[s]).length : 0;

  const liveCountFor = (row: StateCoverage) => services.filter((s) => row.services[s]).length;

  return (
    <div className="mx-auto max-w-4xl">
      {coverage.length > 0 && (
        <div className="mb-8">
          <p className="text-sm font-medium text-charcoal-ink">
            Tap a zone, then a state
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {NIGERIA_ZONES.slice()
              .sort((a, b) => a.row - b.row || a.col - b.col)
              .map((zone) => (
                <div
                  key={zone.id}
                  className="rounded-xl border border-charcoal-ink/10 bg-white p-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
                    {zone.label}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {zone.states.map((stateValue) => {
                      const row = coverage.find((c) => c.state === stateValue);
                      const isSelected = state === stateValue;
                      const live = row ? liveCountFor(row) > 0 : false;
                      return (
                        <button
                          key={stateValue}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setState(stateValue)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                            isSelected
                              ? "border-brand-green bg-brand-green text-white"
                              : "border-charcoal-ink/15 bg-warm-ivory text-charcoal-ink/80 hover:border-brand-green/50"
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              live ? "bg-brand-green" : isSelected ? "bg-white/60" : "bg-charcoal-ink/25"
                            )}
                          />
                          {row?.displayName ?? stateValue}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
          <p className="mt-3 text-xs text-charcoal-ink/50">
            The dot tracks partner-fulfilled services: lab tests (live everywhere today, through
            our nationwide partner Synlab Nigeria), plus home sample collection and medication
            delivery, which still wait on a contracted logistics partner and are not live anywhere
            yet. So every dot below is lit, and it&apos;s the lab check doing that.
          </p>
        </div>
      )}

      <label
        htmlFor="coverage-state"
        className="block text-sm font-medium text-charcoal-ink"
      >
        Or choose a state directly
      </label>
      <select
        id="coverage-state"
        value={state}
        onChange={(event) => setState(event.target.value)}
        className="mt-2 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-charcoal-ink"
      >
        <option value="">Choose a state</option>
        {coverage.map((row) => (
          <option key={row.state} value={row.state}>
            {row.displayName}
          </option>
        ))}
      </select>

      {coverage.length === 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          We could not load the coverage list just now. Please{" "}
          <Link href="/contact" className="underline">
            ask us
          </Link>{" "}
          and we will tell you exactly what is live where you need it.
        </p>
      )}

      {selected && (
        <div className="mt-6 space-y-6">
          <div
            className={`rounded-2xl border p-6 ${
              liveCount > 0
                ? "border-brand-green/30 bg-brand-green/5"
                : "border-charcoal-ink/15 bg-white"
            }`}
          >
            <p className="font-heading text-lg font-semibold text-charcoal-ink">
              {liveCount > 0
                ? `${liveCount} of ${services.length} partner services are live in ${selected.displayName}`
                : `Partner services are not live in ${selected.displayName} yet`}
            </p>
            <p className="mt-1 text-sm text-charcoal-ink/70">
              {liveCount > 0
                ? "Lab tests are booked directly with Synlab Nigeria, our nationwide partner lab. Everything else on this page — monitoring, doctors, pharmacy collection, and specialist referrals — works there today regardless, because those don't depend on a local partner."
                : "Monitoring, doctors over video and text, reminders, the health record, pharmacy collection and specialist referrals all still work there today; those don't depend on a local partner. Lab tests, home sample collection, and medication delivery do, and none of the three is live there yet."}
            </p>

            <ul className="mt-4 space-y-2">
              {services.map((service) => {
                const live = selected.services[service];
                return (
                  <li key={service} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-charcoal-ink">{SERVICE_LABEL[service]}</span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        live
                          ? "bg-brand-green/15 text-deep-forest"
                          : "bg-charcoal-ink/10 text-charcoal-ink/60"
                      }`}
                    >
                      {live ? "Live" : "Not yet"}
                    </span>
                  </li>
                );
              })}
            </ul>

            {liveCount < services.length && (
              <p className="mt-4 text-xs text-charcoal-ink/60">
                We switch a service on in a state only once we have a real contracted partner
                there. We would rather show you nothing than let you book something that cannot
                actually happen.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6">
            <p className="font-heading text-base font-semibold text-charcoal-ink">
              Works in {selected.displayName} today, and everywhere else
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {anywhere.map((item) => (
                <li key={item.key} className="text-sm text-charcoal-ink/70">
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
