"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useContraceptionMethods,
  useContraceptionPlans,
  contraceptionPlansKey,
  type ContraceptionMethod,
} from "@/lib/queries/contraception";
import { requestContraceptionMethod } from "./contraception-actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { Enums } from "@tarragon/shared";

type ContraceptionMethodCategory = Enums<"contraception_method_category">;
type ContraceptionPlanStatus = Enums<"contraception_plan_status">;

const CATEGORY_LABEL: Record<ContraceptionMethodCategory, string> = {
  hormonal_pill: "Pills",
  injectable: "Injectable",
  implant: "Implant",
  iud_hormonal: "Hormonal IUD",
  iud_copper: "Copper IUD",
  barrier: "Barrier methods",
  permanent: "Permanent methods",
  natural_method: "Natural methods",
  emergency: "Emergency contraception",
};

const STATUS_LABEL: Record<ContraceptionPlanStatus, string> = {
  requested: "Requested (awaiting review)",
  active: "Active",
  discontinued: "Discontinued",
  completed: "Completed",
  declined: "Declined",
};

const STATUS_BADGE_VARIANT: Record<
  ContraceptionPlanStatus,
  "grey" | "green" | "amber" | "blue" | "red"
> = {
  requested: "amber",
  active: "green",
  discontinued: "grey",
  completed: "blue",
  declined: "grey",
};

/** Groups the active catalogue by category for display. The 'emergency'
 * category (the emergency pill row) is deliberately excluded here — it has
 * its own prominent, dedicated card (emergency-contraception-card.tsx)
 * precisely so a time-sensitive request is never one browse-and-scroll away
 * from a routine method-comparison list. */
function groupByCategory(
  methods: ContraceptionMethod[]
): Map<ContraceptionMethodCategory, ContraceptionMethod[]> {
  const groups = new Map<ContraceptionMethodCategory, ContraceptionMethod[]>();
  for (const method of methods) {
    if (method.category === "emergency") continue;
    const list = groups.get(method.category) ?? [];
    list.push(method);
    groups.set(method.category, list);
  }
  return groups;
}

/**
 * Contraception browse-and-request panel (spec §47.7). A patient compares
 * methods in plain language and requests one; a clinician later reviews and
 * activates it (that staff-side action is built elsewhere) — this component
 * only ever writes a 'requested' row under the patient's own session.
 */
export function ContraceptionPanel({ patientId }: { patientId: string }) {
  const methods = useContraceptionMethods();
  const plans = useContraceptionPlans(patientId);
  const [state, formAction, pending] = useActionState(requestContraceptionMethod, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: contraceptionPlansKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  const grouped = groupByCategory(methods.data ?? []);
  const methodNameByCode = new Map((methods.data ?? []).map((m) => [m.code, m.name]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Contraception methods
          </CardTitle>
          <CardDescription>
            Compare methods in plain language, then request the one that fits you. Your care
            team will follow up before anything is prescribed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {methods.isLoading && (
            <p className="text-sm text-charcoal-ink/60">Loading methods…</p>
          )}
          {[...grouped.entries()].map(([category, categoryMethods]) => (
            <div key={category} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
                {CATEGORY_LABEL[category]}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {categoryMethods.map((method) => (
                  <div
                    key={method.code}
                    className="flex flex-col justify-between gap-3 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-charcoal-ink">{method.name}</p>
                        {method.requires_prescription && (
                          <Badge variant="blue">Needs a clinician</Badge>
                        )}
                      </div>
                      <p className="text-sm text-charcoal-ink/70">{method.description}</p>
                      {method.typical_effectiveness_pct != null && (
                        <p className="text-xs text-charcoal-ink/60">
                          About {method.typical_effectiveness_pct}% effective with typical use
                        </p>
                      )}
                    </div>
                    <form action={formAction}>
                      <input type="hidden" name="method_code" value={method.code} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        className="w-full"
                      >
                        {pending ? "Sending…" : "Request this method"}
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card variant="soft">
        <CardHeader>
          <CardTitle className="text-base">Your contraception plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {plans.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {plans.data?.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              You haven&apos;t requested a method yet. Browse above whenever you&apos;re ready.
            </p>
          )}
          {plans.data?.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-col gap-2 rounded-md border border-charcoal-ink/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-charcoal-ink">
                  {methodNameByCode.get(plan.method_code) ?? plan.method_code.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-charcoal-ink/60">
                  Requested {new Date(plan.requested_at).toLocaleDateString()}
                </p>
              </div>
              <Badge variant={STATUS_BADGE_VARIANT[plan.status]}>
                {STATUS_LABEL[plan.status]}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
