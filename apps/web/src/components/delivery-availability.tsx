"use client";

import { useMatchedLogisticsPartners } from "@/lib/queries/logistics-partners";
import { koboToNaira } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";

/**
 * Data-driven delivery availability block for a pharmacy order. Same
 * no-flag design as HomeCollectionAvailability: zero active
 * logistics_partners rows for a region is what produces the "coming soon"
 * block below, not a boolean setting. Once ops activates a real partner row
 * covering the order's delivery_address.state, this same component starts
 * rendering the real delivery-tracking status for every subsequent order in
 * that region.
 */
export function DeliveryAvailability({
  region,
  logisticsPartnerName,
  estimatedDeliveryAt,
  courierReference,
  deliveryConfirmedAt,
}: {
  region: string | null;
  logisticsPartnerName?: string | null;
  estimatedDeliveryAt?: string | null;
  courierReference?: string | null;
  deliveryConfirmedAt?: string | null;
}) {
  const { data: partners, isLoading } = useMatchedLogisticsPartners({ region: region ?? undefined });

  if (deliveryConfirmedAt) {
    return (
      <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
        <Badge variant="green">Delivered</Badge>
        <p className="mt-1 text-xs text-charcoal-ink/60">
          Confirmed {new Date(deliveryConfirmedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
        </p>
      </div>
    );
  }

  if (logisticsPartnerName) {
    return (
      <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
        <div className="mb-1 flex items-center gap-2">
          <Badge variant="blue">Out for delivery</Badge>
        </div>
        <p className="text-sm text-charcoal-ink">
          {logisticsPartnerName}
          {courierReference && <span className="text-charcoal-ink/60"> · Ref {courierReference}</span>}
        </p>
        {estimatedDeliveryAt && (
          <p className="text-xs text-charcoal-ink/60">
            Estimated arrival{" "}
            {new Date(estimatedDeliveryAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-xs text-charcoal-ink/60">Checking delivery availability…</p>;
  }

  const available = (partners?.length ?? 0) > 0;

  if (!available) {
    return (
      <div className="rounded-lg border border-dashed border-charcoal-ink/15 bg-charcoal-ink/[0.02] p-3">
        <p className="text-sm font-medium text-charcoal-ink/70">Delivery: coming soon in your area</p>
        <p className="text-xs text-charcoal-ink/50">
          We can&apos;t yet deliver medication to you directly — please collect from the pharmacy
          partner instead. We&apos;ll let you know as soon as delivery is available near you.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge variant="green">Delivery available</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        {partners!.length === 1
          ? `${partners![0].name} delivers to your area`
          : `${partners!.length} delivery partners cover your area`}
        {partners![0].delivery_fee_kobo > 0 &&
          ` — from ₦${koboToNaira(partners![0].delivery_fee_kobo).toLocaleString()}`}
        . Your care team will arrange courier pickup once your order is confirmed.
      </p>
    </div>
  );
}
