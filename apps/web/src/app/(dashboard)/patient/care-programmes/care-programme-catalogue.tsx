"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { purchaseCareProgramme } from "./actions";

/** Naira display for a kobo amount, e.g. 1500000 -> "₦15,000.00". Same local
 * convention as pharmacist-orders.tsx's formatNaira — no shared helper exists
 * in this codebase for this yet. */
function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

export type CareProgrammeCatalogueItem = {
  id: string;
  name: string;
  short_description: string | null;
  purchase_summary: string | null;
  price_kobo: number | null;
  default_duration_weeks: number | null;
  /** This patient's own purchase status for this programme, if any. */
  activePurchase: { ends_at: string } | null;
  pendingPurchase: boolean;
};

function ProgrammeCard({ programme }: { programme: CareProgrammeCatalogueItem }) {
  const [state, action, pending] = useActionState(purchaseCareProgramme, undefined);
  const purchasable = programme.price_kobo != null && programme.price_kobo > 0
    && programme.default_duration_weeks != null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{programme.name}</CardTitle>
          {programme.activePurchase && <Badge variant="green">Active</Badge>}
          {programme.pendingPurchase && !programme.activePurchase && (
            <Badge variant="amber">Payment pending</Badge>
          )}
        </div>
        <CardDescription>{programme.short_description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {programme.purchase_summary && (
          <p className="text-sm text-charcoal-ink/70">{programme.purchase_summary}</p>
        )}

        {programme.activePurchase ? (
          <p className="text-sm text-charcoal-ink/60">
            Your programme runs until{" "}
            {new Date(programme.activePurchase.ends_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            .
          </p>
        ) : purchasable ? (
          <form action={action} className="space-y-2">
            <input type="hidden" name="programmeId" value={programme.id} />
            <p className="text-lg font-semibold text-charcoal-ink">
              {formatNaira(programme.price_kobo!)}
              <span className="ml-1 text-sm font-normal text-charcoal-ink/60">
                for {programme.default_duration_weeks} weeks
              </span>
            </p>
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            <Button type="submit" disabled={pending || programme.pendingPurchase}>
              {pending
                ? "Starting checkout…"
                : programme.pendingPurchase
                  ? "Payment pending — resume from your dashboard"
                  : "Start this programme"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-charcoal-ink/50">Not yet available for purchase.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function CareProgrammeCatalogue({ programmes }: { programmes: CareProgrammeCatalogueItem[] }) {
  if (programmes.length === 0) {
    return (
      <p className="text-sm text-charcoal-ink/60">
        No Care Programmes are available to purchase yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {programmes.map((programme) => (
        <ProgrammeCard key={programme.id} programme={programme} />
      ))}
    </div>
  );
}
