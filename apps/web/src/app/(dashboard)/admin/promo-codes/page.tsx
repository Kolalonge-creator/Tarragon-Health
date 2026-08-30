import { PromoCodeManager } from "./promo-code-manager";

export default function AdminPromoCodesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Promo codes</h1>
        <p className="text-charcoal-ink/60">
          Percentage or fixed-amount discounts a patient can apply to a lab, pharmacy, or referral
          order at checkout.
        </p>
      </div>
      <PromoCodeManager />
    </div>
  );
}
