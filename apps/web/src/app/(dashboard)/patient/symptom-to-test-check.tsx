"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useLabCatalogue,
  useCreateLabOrder,
  findSingleTestBundle,
} from "@/lib/queries/lab-orders";
import {
  matchSymptomClusters,
  SYMPTOM_OPTIONS,
  type SymptomCluster,
} from "@/lib/symptom-check/symptom-clusters";

/**
 * Dashboard version of the public symptom checker (see
 * apps/web/(marketing)/_components/symptom-to-test-check.tsx for the
 * anonymous variant). Same matching logic, but the CTAs are real: requesting
 * a self-bookable test inserts a lab_orders row the same way
 * AnnualHealthCheckBooking does; a non-self-bookable cluster routes to
 * messaging the care team instead of a fake/disabled button, since not
 * every screen_type has a self-bookable single-test bundle today.
 */
export function SymptomToTestCheck({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const { data: bundles } = useLabCatalogue();
  const createOrder = useCreateLabOrder();

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

  const result = submitted ? matchSymptomClusters([...selected]) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Symptom Checker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!result && (
          <>
            <p className="text-sm text-charcoal-ink/70">
              Tick anything you&apos;ve been noticing lately. This isn&apos;t a diagnosis, just a
              starting point.
            </p>
            <fieldset>
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
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-charcoal-ink/50">{selected.size} selected</p>
              <Button type="button" disabled={selected.size === 0} onClick={() => setSubmitted(true)}>
                See my suggestion
              </Button>
            </div>
          </>
        )}

        {result?.dangerFlag && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5">
            <p className="font-heading text-base font-semibold text-red-800">
              This is worth a doctor&apos;s attention now
            </p>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">
              What you&apos;ve selected isn&apos;t something to figure out from a symptom
              checklist. Please reach out to your care team now.
            </p>
            <Button asChild className="mt-4">
              <Link href="/patient/care">Talk to your care team</Link>
            </Button>
          </div>
        )}

        {result && !result.dangerFlag && (
          <div className="space-y-4">
            {result.matched.length === 0 ? (
              <p className="rounded-xl border border-charcoal-ink/10 bg-soft-sage p-5 text-sm leading-relaxed text-charcoal-ink/75">
                What you&apos;ve described doesn&apos;t clearly match a pattern we check for here.
                That doesn&apos;t mean it&apos;s nothing, a doctor is the right next step to look
                at it properly.{" "}
                <Link href="/patient/care" className="font-medium text-brand-green hover:underline">
                  Talk to a doctor
                </Link>
                .
              </p>
            ) : (
              result.matched.map((cluster) => (
                <ClusterSuggestion
                  key={cluster.id}
                  cluster={cluster}
                  bundle={findSingleTestBundle(bundles ?? [], cluster.screenTypeCode)}
                  patientId={patientId}
                  organisationId={organisationId}
                  onRequest={(panelBundleId) =>
                    organisationId &&
                    createOrder.mutate({ organisationId, patientId, panelBundleId })
                  }
                  requesting={createOrder.isPending}
                />
              ))
            )}
          </div>
        )}

        {result && (
          <Button type="button" variant="outline" onClick={reset}>
            Start over
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ClusterSuggestion({
  cluster,
  bundle,
  onRequest,
  requesting,
}: {
  cluster: SymptomCluster;
  bundle: ReturnType<typeof findSingleTestBundle>;
  patientId: string;
  organisationId: string | null;
  onRequest: (panelBundleId: string) => void;
  requesting: boolean;
}) {
  const canRequestDirectly = !!bundle?.self_bookable;

  return (
    <div className="rounded-xl border-2 border-brand-green bg-brand-green/5 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading text-base font-semibold text-charcoal-ink">{cluster.name}</p>
        <Badge variant="green">Suggested</Badge>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">{cluster.patientExplanation}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {canRequestDirectly && bundle ? (
          <Button type="button" onClick={() => onRequest(bundle.id)} disabled={requesting}>
            Request this test
          </Button>
        ) : (
          <Button asChild>
            <Link href="/patient/messages">Ask your doctor about this test</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/patient/care">Talk to a doctor first</Link>
        </Button>
      </div>
    </div>
  );
}
