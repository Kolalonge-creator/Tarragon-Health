"use client";

import { useEffect, useMemo, useState } from "react";
import { koboToNaira, type Enums } from "@tarragon/shared";
import { useActiveServiceProducts } from "@/lib/queries/service-products";
import { useMyServicePurchases, isPurchaseCurrentlyActive } from "@/lib/queries/service-purchases";
import {
  useRedeemCancerScreeningPurchase,
  CANCER_SCREENING_PRODUCT_CODES,
  type CancerScreeningProductCode,
} from "@/lib/queries/cancer-screening";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/** Which of the four bundles make sense to even show, by sex. Sex unknown
 * (not yet recorded) hides all four rather than guessing — same posture as
 * PreventiveProgrammes' Men's/Women's Health gating. */
function isOfferedFor(code: CancerScreeningProductCode, sex: Enums<"sex"> | null): boolean {
  if (sex === null) return false;
  if (code === "cancer_screen_men_45plus") return sex === "male";
  return sex === "female"; // the other three are all cervical/women's-track
}

/**
 * One-off cancer screening bundles (2026-09-03 catalogue rebuild): a real,
 * guideline-backed step up from the Annual Health Check, redeeming into the
 * same screening_schedules the periodic engine already owns — see
 * redeem_cancer_screening_purchase. A purchase is spent automatically the
 * first time this card notices it's available and unredeemed (right after
 * checkout returns here, or on any later visit if that redirect was
 * missed) — no separate "confirm" click, since there's no decision left for
 * the patient to make at that point.
 */
export function CancerScreeningCard({
  patientId,
  sex,
}: {
  patientId: string;
  sex: Enums<"sex"> | null;
}) {
  const { data: products, isLoading, isError } = useActiveServiceProducts();
  const { data: purchases } = useMyServicePurchases();
  const redeem = useRedeemCancerScreeningPurchase(patientId);
  const [buyingCode, setBuyingCode] = useState<CancerScreeningProductCode | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  const offeredCodes = useMemo(
    () => CANCER_SCREENING_PRODUCT_CODES.filter((code) => isOfferedFor(code, sex)),
    [sex]
  );

  const bundles = useMemo(
    () =>
      offeredCodes
        .map((code) => (products ?? []).find((p) => p.code === code))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .sort((a, b) => a.price_kobo - b.price_kobo),
    [products, offeredCodes]
  );

  const purchaseByCode = useMemo(() => {
    const map = new Map<string, (typeof purchases extends (infer T)[] | undefined ? T : never)>();
    for (const purchase of purchases ?? []) {
      const code = purchase.service_product?.code;
      if (code && offeredCodes.includes(code as CancerScreeningProductCode)) {
        // Newest first (useMyServicePurchases orders that way) — keep the
        // first one seen per code.
        if (!map.has(code)) map.set(code, purchase);
      }
    }
    return map;
  }, [purchases, offeredCodes]);

  // Spend any available-but-unredeemed credit as soon as it's visible —
  // covers the checkout-callback landing here, and a later revisit if that
  // redirect didn't round-trip cleanly. redeem_cancer_screening_purchase is
  // a no-op once already redeemed, so re-running this on every render of a
  // freshly-redeemed purchase costs nothing beyond one extra RPC call.
  useEffect(() => {
    for (const [code, purchase] of purchaseByCode) {
      if (
        isPurchaseCurrentlyActive(purchase) &&
        !purchase.redeemed_at &&
        !redeem.isPending
      ) {
        redeem.mutate(code as CancerScreeningProductCode);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseByCode]);

  if (offeredCodes.length === 0) return null;

  async function buy(code: CancerScreeningProductCode) {
    setBuyingCode(code);
    setBuyError(null);
    try {
      const result = await purchaseServiceProduct({
        serviceProductCode: code,
        callbackPath: "/patient/prevention#programmes",
      });
      if (result?.error) {
        setBuyError(result.error);
        return;
      }
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
    } finally {
      setBuyingCode(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Cancer screening
        </CardTitle>
        <CardDescription>
          A guideline-backed step up from the Annual Health Check, with a doctor consult built in
          to walk through the result either way.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load these screenings.</p>}

        <ul className="divide-y divide-charcoal-ink/10">
          {bundles.map((bundle) => {
            const purchase = purchaseByCode.get(bundle.code);
            const active = purchase && isPurchaseCurrentlyActive(purchase);
            const redeemed = active && !!purchase?.redeemed_at;
            const pendingRedemption = active && !purchase?.redeemed_at;

            return (
              <li key={bundle.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
                  {bundle.description && (
                    <p className="text-xs text-charcoal-ink/60">{bundle.description}</p>
                  )}
                  {redeemed && (
                    <p className="mt-1 text-xs text-brand-green">
                      Paid for — added to your screening calendar.
                    </p>
                  )}
                  {pendingRedemption && (
                    <p className="mt-1 text-xs text-charcoal-ink/60">Setting up your booking…</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {redeemed ? (
                    <Badge variant="green">Scheduled</Badge>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-charcoal-ink">
                        ₦{koboToNaira(bundle.price_kobo).toLocaleString("en-NG")}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        disabled={buyingCode === bundle.code || pendingRedemption}
                        onClick={() => buy(bundle.code as CancerScreeningProductCode)}
                      >
                        {buyingCode === bundle.code ? "Taking you to payment…" : "Buy & schedule"}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {buyError && <p className="text-sm text-red-600">{buyError}</p>}
      </CardContent>
    </Card>
  );
}
