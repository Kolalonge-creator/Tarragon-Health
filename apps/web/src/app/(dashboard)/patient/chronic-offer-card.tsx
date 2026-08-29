"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ChronicProgrammeOfferRow } from "@tarragon/shared";
import { declineChronicOfferAction } from "./chronic-offer-actions";

const PLAN_LABEL: Record<string, string> = {
  essential: "Essential Care",
  complete: "Complete Care",
};

export function ChronicOfferCard({ offer }: { offer: ChronicProgrammeOfferRow }) {
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (dismissed) return null;

  return (
    <Card className="border-tarragon-green/30 bg-tarragon-green/5">
      <CardContent className="space-y-3 py-4">
        <p className="text-sm font-medium text-charcoal-ink">
          Your care team recommends {PLAN_LABEL[offer.recommended_plan_code] ?? offer.recommended_plan_code}
        </p>
        <p className="text-sm text-charcoal-ink/80">{offer.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/patient/subscription">See the plan</Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await declineChronicOfferAction(offer.id);
                if (result.error) setError(result.error);
                else setDismissed(true);
              })
            }
          >
            Not right now
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
