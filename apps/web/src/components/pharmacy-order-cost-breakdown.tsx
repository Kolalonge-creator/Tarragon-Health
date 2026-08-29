import { koboToNaira } from "@tarragon/shared";
import type { PharmacyOrderItem } from "@/lib/queries/pharmacy-orders";

/**
 * Itemized medicine / delivery / total cost view (spec §63.14). Purely
 * presentational — never changes what's actually charged
 * (pharmacy_orders.total_kobo, set once at order creation). The delivery fee
 * is shown as informational only: nothing in this codebase bills it through
 * Tarragon today (logistics_partners.delivery_fee_kobo is reference data
 * the courier collects directly) — consistent with the platform-wide "we
 * take no cut, you pay direct" commitment
 * (apps/web/src/app/(marketing)/_content/pricing.ts's "YOU PAY THE LAB"
 * label). This component must never imply Tarragon collected a delivery fee
 * it didn't actually charge.
 */
export function PharmacyOrderCostBreakdown({
  items,
  totalKobo,
  deliveryFeeKobo,
  fulfilmentMethod,
}: {
  items: PharmacyOrderItem[];
  totalKobo: number;
  deliveryFeeKobo?: number | null;
  fulfilmentMethod: "pickup" | "delivery";
}) {
  const medicineKobo = items.reduce((sum, item) => sum + item.price_kobo * item.quantity, 0);

  return (
    <div className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-xs">
      <div className="flex items-center justify-between py-0.5">
        <span className="text-charcoal-ink/60">Medicine</span>
        <span className="text-charcoal-ink">₦{koboToNaira(medicineKobo).toLocaleString()}</span>
      </div>
      {fulfilmentMethod === "delivery" && (
        <div className="flex items-center justify-between py-0.5">
          <span className="text-charcoal-ink/60">Delivery</span>
          <span className="text-charcoal-ink">
            {deliveryFeeKobo != null ? `₦${koboToNaira(deliveryFeeKobo).toLocaleString()}` : "To be confirmed"}
          </span>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between border-t border-charcoal-ink/10 pt-1.5 font-semibold">
        <span className="text-charcoal-ink">Total charged via Tarragon</span>
        <span className="text-charcoal-ink">₦{koboToNaira(totalKobo).toLocaleString()}</span>
      </div>
      {fulfilmentMethod === "delivery" && (
        <p className="mt-1.5 text-[11px] text-charcoal-ink/45">
          The delivery fee is paid to the courier directly and isn&apos;t included in the Tarragon total above.
        </p>
      )}
    </div>
  );
}
