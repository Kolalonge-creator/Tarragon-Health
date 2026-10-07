"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PharmacyOrderStatus } from "@tarragon/shared";

function formatWhen(iso?: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

type StepState = "done" | "current" | "upcoming";

function Step({ label, state, when }: { label: string; state: StepState; when?: string | null }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          state === "done" && "bg-brand-green text-white",
          state === "current" && "border-2 border-brand-green bg-white text-brand-green",
          state === "upcoming" && "border border-charcoal-ink/20 bg-white text-transparent",
        )}
      >
        {state === "done" ? "✓" : state === "current" ? "●" : "○"}
      </span>
      <span className="flex-1">
        <span
          className={cn(
            "block text-sm",
            state === "upcoming" ? "text-charcoal-ink/40" : "font-medium text-charcoal-ink",
          )}
        >
          {label}
        </span>
        {when && <span className="text-[11px] text-charcoal-ink/50">{formatWhen(when)}</span>}
      </span>
    </li>
  );
}

/**
 * Patient-facing collection status checklist (spec §63.9). Orders are
 * collection only: the steps end at "ready for collection". 'unavailable'
 * renders as a distinct note instead of a normal step, since it is a break
 * in the happy path that needs the patient's attention (spec §63.4).
 */
export function PharmacyOrderStatusTimeline({
  orderNumber,
  status,
  requestedAt,
  dispensedAt,
  unavailableReason,
}: {
  orderNumber?: string | null;
  status: PharmacyOrderStatus;
  requestedAt: string;
  dispensedAt?: string | null;
  unavailableReason?: string | null;
}) {
  const medicationPrepared = status === "dispensed" || !!dispensedAt;

  if (status === "unavailable") {
    return (
      <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
        {orderNumber && <p className="mb-2 text-xs text-charcoal-ink/50">Order {orderNumber}</p>}
        <ul className="space-y-2.5">
          <Step label="Prescription received" state="done" when={requestedAt} />
        </ul>
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5">
          <Badge variant="amber">Medicine unavailable</Badge>
          <p className="mt-1.5 text-xs leading-relaxed text-amber-900">
            {unavailableReason || "The pharmacy could not fulfil this as prescribed."} We&apos;ll let you know if a
            substitute becomes available, or you can try another participating pharmacy.
          </p>
        </div>
      </div>
    );
  }

  const steps: { label: string; state: StepState; when?: string | null }[] = [
    { label: "Prescription received", state: "done", when: requestedAt },
    {
      label: "Medication prepared / ready for collection",
      state: medicationPrepared ? "done" : "current",
      when: dispensedAt,
    },
  ];

  return (
    <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
      {orderNumber && <p className="mb-2 text-xs text-charcoal-ink/50">Order {orderNumber}</p>}
      <ul className="space-y-2.5">
        {steps.map((step) => (
          <Step key={step.label} {...step} />
        ))}
      </ul>
    </div>
  );
}
