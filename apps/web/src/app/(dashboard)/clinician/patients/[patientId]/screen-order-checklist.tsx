"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScreeningResultForm } from "./screening-result-form";
import { EcgResultPanel } from "./ecg-result-panel";
import { setScreeningResultFollowUpAction } from "./screening-result-actions";
import type { SCREENING_RESULT_SCREEN_TYPES } from "@/lib/validation/screening-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ScreenType = (typeof SCREENING_RESULT_SCREEN_TYPES)[number];

export type ScreenOrderChecklistItem = {
  orderId: string;
  orderNumber: string | null;
  bundleName: string;
  codes: {
    code: string;
    label: string;
    satisfied: boolean;
    resultId: string | null;
    resultStatus: string | null;
    followUpAction: string | null;
  }[];
};

function FollowUpActionForm({ resultId, onSaved }: { resultId: string; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(
    setScreeningResultFollowUpAction.bind(null, resultId),
    undefined
  );
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      router.refresh();
      onSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-start gap-2">
      <Input
        name="follow_up_action"
        placeholder="What should happen next for this result?"
        className="min-w-[220px] flex-1"
        required
      />
      <Input
        name="recall_months"
        type="number"
        min={1}
        max={60}
        placeholder="Repeat in (months)"
        className="w-40"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save follow-up"}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

/**
 * One card per open Screen-tier order, listing its outstanding lab codes.
 * Clicking an outstanding code opens ScreeningResultForm locked to that
 * code + order; an abnormal/critical result with no follow_up_action yet
 * gets an inline prompt to set one (setScreeningResultFollowUpAction —
 * clinical-staff-gated, see that action's own comment).
 */
export function ScreenOrderChecklist({
  patientId,
  item,
}: {
  patientId: string;
  item: ScreenOrderChecklistItem;
}) {
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [showFollowUpFor, setShowFollowUpFor] = useState<Record<string, boolean>>({});
  const router = useRouter();

  const outstanding = item.codes.filter((c) => !c.satisfied);
  const done = item.codes.filter((c) => c.satisfied);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {item.bundleName}
          {item.orderNumber && (
            <span className="text-xs font-normal text-charcoal-ink/60">{item.orderNumber}</span>
          )}
          <Badge variant={outstanding.length === 0 ? "green" : "amber"}>
            {outstanding.length === 0
              ? "All entered"
              : `${outstanding.length} of ${item.codes.length} outstanding`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-charcoal-ink/10">
          {item.codes.map((c) => {
            const needsFollowUp =
              c.satisfied &&
              c.resultStatus &&
              ["abnormal", "critical"].includes(c.resultStatus) &&
              !c.followUpAction;
            // Borderline results don't force the amber "needs follow-up"
            // badge (abnormal/critical already escalates to a doctor
            // separately), but a clinician can still optionally record a
            // recall/follow-up note for one — the most common real-world
            // "this needs a repeat sooner" case.
            const canOfferFollowUp =
              c.satisfied && !c.followUpAction && (needsFollowUp || c.resultStatus === "borderline");
            return (
              <li key={c.code} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-charcoal-ink">{c.label}</span>
                  {c.satisfied ? (
                    <Badge variant={needsFollowUp ? "amber" : "green"}>
                      {needsFollowUp ? "Needs follow-up action" : "Entered"}
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveCode(activeCode === c.code ? null : c.code)}
                    >
                      {activeCode === c.code ? "Cancel" : "Enter result"}
                    </Button>
                  )}
                </div>
                {c.satisfied && c.followUpAction && (
                  <p className="mt-1 text-xs text-charcoal-ink/70">
                    Follow-up: {c.followUpAction}
                  </p>
                )}
                {canOfferFollowUp && c.resultId && (
                  showFollowUpFor[c.code] ? (
                    <FollowUpActionForm
                      resultId={c.resultId}
                      onSaved={() => setShowFollowUpFor((s) => ({ ...s, [c.code]: false }))}
                    />
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setShowFollowUpFor((s) => ({ ...s, [c.code]: true }))}
                    >
                      Add follow-up action
                    </Button>
                  )
                )}
                {activeCode === c.code && !c.satisfied && (
                  <div className="mt-3">
                    {c.code === "ecg_resting" ? (
                      <EcgResultPanel
                        patientId={patientId}
                        labOrderId={item.orderId}
                        onSuccess={() => {
                          setActiveCode(null);
                          router.refresh();
                        }}
                      />
                    ) : (
                      <ScreeningResultForm
                        patientId={patientId}
                        labOrderId={item.orderId}
                        lockedScreenType={c.code as ScreenType}
                        onSuccess={() => {
                          setActiveCode(null);
                          router.refresh();
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {done.length === item.codes.length && (
          <p className="text-xs text-charcoal-ink/60">
            Every applicable code for this order has a result — it should show as resulted shortly.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
