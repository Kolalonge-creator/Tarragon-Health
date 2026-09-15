"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PharmacyOrderStatus } from "@tarragon/shared";

const FAILURE_REASON_COPY: Record<string, string> = {
  patient_unavailable: "Nobody was available to receive it",
  incorrect_address: "The delivery address needs to be corrected",
  courier_failure: "The courier could not complete the delivery",
  security_access_issue: "The courier could not access the delivery location",
  other: "The delivery could not be completed",
};

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
 * Patient-facing delivery/collection status checklist (spec §63.9 —
 * "Order #1234 / ✓ Prescription received / ✓ Medication prepared / ...").
 * Pickup orders skip the courier/delivery steps and end at "Ready for
 * collection"; delivery orders show the full courier chain. 'unavailable'
 * and 'delivery_failed' render as a distinct alert instead of a normal step,
 * since both are a break in the happy path that needs the patient's
 * attention (spec §63.4, §63.10) rather than just another checkbox.
 */
export function DeliveryStatusTimeline({
  orderNumber,
  status,
  fulfilmentMethod,
  requestedAt,
  dispensedAt,
  courierName,
  courierAssignedAt,
  estimatedDeliveryAt,
  deliveredAt,
  requiresColdChain,
  unavailableReason,
  latestFailureReason,
}: {
  orderNumber?: string | null;
  status: PharmacyOrderStatus;
  fulfilmentMethod: "pickup" | "delivery";
  requestedAt: string;
  dispensedAt?: string | null;
  courierName?: string | null;
  courierAssignedAt?: string | null;
  estimatedDeliveryAt?: string | null;
  deliveredAt?: string | null;
  requiresColdChain?: boolean;
  unavailableReason?: string | null;
  latestFailureReason?: string | null;
}) {
  const preparedStatuses: PharmacyOrderStatus[] = ["dispensed", "out_for_delivery", "delivery_failed", "delivered"];
  const outStatuses: PharmacyOrderStatus[] = ["out_for_delivery", "delivery_failed", "delivered"];

  const medicationPrepared = preparedStatuses.includes(status) || !!dispensedAt;
  const courierAssigned = fulfilmentMethod === "delivery" && (outStatuses.includes(status) || !!courierAssignedAt);
  const outForDelivery = fulfilmentMethod === "delivery" && outStatuses.includes(status);
  const delivered = status === "delivered";

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
      label: fulfilmentMethod === "pickup" ? "Medication prepared / ready for collection" : "Medication prepared",
      state: medicationPrepared ? "done" : "current",
      when: dispensedAt,
    },
  ];

  if (fulfilmentMethod === "delivery") {
    steps.push(
      {
        label: "Courier assigned",
        state: courierAssigned ? "done" : medicationPrepared ? "current" : "upcoming",
        when: courierAssignedAt,
      },
      {
        label: outForDelivery
          ? `Out for delivery${courierName ? ` — ${courierName}` : ""}`
          : "Out for delivery",
        state: outForDelivery ? "done" : courierAssigned ? "current" : "upcoming",
        when: courierAssignedAt,
      },
      {
        label: "Delivered",
        state: delivered ? "done" : outForDelivery && status !== "delivery_failed" ? "current" : "upcoming",
        when: deliveredAt,
      },
    );
  }

  return (
    <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
      {orderNumber && <p className="mb-2 text-xs text-charcoal-ink/50">Order {orderNumber}</p>}
      <ul className="space-y-2.5">
        {steps.map((step) => (
          <Step key={step.label} {...step} />
        ))}
      </ul>
      {requiresColdChain && fulfilmentMethod === "delivery" && !delivered && (
        <p className="mt-2.5 text-[11px] text-charcoal-ink/50">
          This medicine needs to stay refrigerated — it&apos;s packed and couriered cold-chain.
        </p>
      )}
      {fulfilmentMethod === "delivery" && estimatedDeliveryAt && !delivered && status !== "delivery_failed" && (
        <p className="mt-1 text-[11px] text-charcoal-ink/50">Estimated arrival {formatWhen(estimatedDeliveryAt)}</p>
      )}
      {status === "delivery_failed" && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2.5">
          <Badge variant="red">Delivery attempt unsuccessful</Badge>
          <p className="mt-1.5 text-xs leading-relaxed text-red-900">
            {FAILURE_REASON_COPY[latestFailureReason ?? "other"] ?? FAILURE_REASON_COPY.other}. We&apos;ll arrange
            another delivery attempt — you can also update your delivery address below.
          </p>
        </div>
      )}
    </div>
  );
}
