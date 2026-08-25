"use client";

import { useMemo, useState } from "react";
import {
  useLabCatalogue,
  useCreateLabOrder,
  useCreatePartnerLabOrder,
  usePatientLabOrders,
  type PanelBundle,
} from "@/lib/queries/lab-orders";
import { useRegionServiceAvailable } from "@/lib/queries/service-regions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ReviewPrice } from "./review-price";
import { cn } from "@/lib/utils";

/**
 * An order still waiting on something from the patient. `pending_payment`
 * only ever appears here for a partner-fulfilled order — a self-arranged one
 * is created straight into 'ordered' (private.enforce_lab_order_origin
 * refuses a self-arranged order any other status), so this list never shows
 * a pay prompt for something the patient was never going to be charged for.
 */
const OPEN_STATUSES = [
  "pending_payment",
  "payment_confirmed",
  "ordered",
  "sample_collected",
  "processing",
];

/** Health Check packages vs confidential single screenings — both are the
 * self_bookable set (WHO-essential only, per migration 20260723164727).
 * `screen_core`/`screen_advanced`/`screen_comprehensive` are the
 * Core/Advanced/Comprehensive Screen tiers that replaced the old
 * `annual_health_check`/`health_check_comprehensive` bundles. */
const isPackage = (b: PanelBundle) =>
  b.code.startsWith("health_check") || b.code.startsWith("screen_");

/** The WHO-essential confidential screenings (cervical smear, HIV, Hep B,
 * Hep C) vs. other self-bookable single tests (e.g. blood group & genotype,
 * migration 20260724020715) that don't carry the same privacy framing. */
const CONFIDENTIAL_CODES = ["single_cervical_smear", "single_hiv", "single_hep_b", "single_hep_c"];
const isConfidential = (b: PanelBundle) => CONFIDENTIAL_CODES.includes(b.code);

const REBOOK_AFTER_MONTHS = 11;

/**
 * The Screen ladder, self-arranged: Tarragon writes the request saying which
 * tests are needed and why, the patient takes it to whichever lab they like and
 * pays that lab directly, then uploads the result here for a doctor to read.
 *
 * Tarragon takes nothing on the test itself wherever partner fulfilment is not
 * live, which is everywhere today — there is no partner to route the sample to
 * and no charge to collect, and private.enforce_lab_order_origin enforces that
 * on the row rather than leaving it to this component. Where a laboratory IS
 * contracted and switched on for the patient's state, the founder's 2026-08-21
 * decision applies instead: Tarragon bills one price for the review, computed
 * for that patient. Neither claim is hardcoded here — ReviewPrice reads the
 * same region gate the database does and says whichever is true.
 *
 * `screensEnabled` gates the curated ladder as a subscription feature. What is
 * NEVER gated, on any plan: uploading a result, a doctor reading it, and the
 * abnormal-result escalation pipeline. Safety is not a paid feature here.
 */
export function AnnualHealthCheckBooking({
  patientId,
  organisationId,
  sex,
  state,
  screensEnabled = true,
}: {
  patientId: string;
  organisationId: string | null;
  /** Hides sex-specific single screenings (e.g. cervical smear for men). */
  sex?: string | null;
  /**
   * Nigerian state, used only to ask whether Tarragon is billing for tests
   * here yet (region_service_available(state, 'lab')). ReviewPrice decides
   * what to say about money from that; this component never asserts it.
   */
  state?: string | null;
  screensEnabled?: boolean;
}) {
  const { data: bundles } = useLabCatalogue();
  const { data: orders } = usePatientLabOrders(patientId);
  const createOrder = useCreateLabOrder();
  const createPartnerOrder = useCreatePartnerLabOrder();
  // Same gate ReviewPrice reads — whether Tarragon actually bills for a test
  // in this patient's state, or the patient pays a laboratory directly.
  const { data: partnerBillingAvailable } = useRegionServiceAvailable(state, "lab");
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  // Captured once on mount so the render stays pure (lint: no Date.now() in
  // render); a rebook nudge doesn't need a live-ticking clock.
  const [nowMs] = useState(() => Date.now());

  const selfBookable = useMemo(
    () =>
      (bundles ?? [])
        .filter((b) => b.self_bookable)
        .filter((b) => !(sex === "male" && !isPackage(b) && b.test_codes.includes("cervical_smear")))
        .sort((a, b) => a.price_kobo - b.price_kobo),
    [bundles, sex]
  );
  const packages = selfBookable.filter(isPackage);
  const confidential = selfBookable.filter((b) => !isPackage(b) && isConfidential(b));
  const otherTests = selfBookable.filter((b) => !isPackage(b) && !isConfidential(b));

  const selfBookableIds = useMemo(
    () => new Set((bundles ?? []).filter((b) => b.self_bookable).map((b) => b.id)),
    [bundles]
  );
  const myOrders = (orders ?? []).filter(
    (o) => o.panel_bundle_id && selfBookableIds.has(o.panel_bundle_id)
  );
  const openOrders = myOrders.filter((o) => OPEN_STATUSES.includes(o.status));
  const openBundleIds = new Set(openOrders.map((o) => o.panel_bundle_id));

  const lastResulted = myOrders.find((o) => o.status === "resulted");
  const rebookDue =
    openOrders.length === 0 &&
    !!lastResulted &&
    nowMs - new Date(lastResulted.created_at).getTime() >
      REBOOK_AFTER_MONTHS * 30 * 24 * 60 * 60 * 1000;

  const selected =
    selfBookable.find((b) => b.id === selectedBundleId) ??
    packages.find((b) => b.code === "screen_core") ??
    selfBookable[0] ??
    null;

  if (selfBookable.length === 0 || !organisationId) return null;

  const bundleRow = (bundle: PanelBundle) => {
    const isSelected = selected?.id === bundle.id;
    const hasOpenOrder = openBundleIds.has(bundle.id);
    return (
      <button
        key={bundle.id}
        type="button"
        disabled={hasOpenOrder}
        aria-pressed={isSelected}
        onClick={() => setSelectedBundleId(bundle.id)}
        className={cn(
          "w-full rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green",
          isSelected
            ? "border-brand-green bg-brand-green/5"
            : "border-charcoal-ink/10 hover:border-charcoal-ink/25",
          hasOpenOrder && "opacity-60"
        )}
      >
        <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
        {bundle.description && (
          <p className="mt-1 text-xs text-charcoal-ink/60">{bundle.description}</p>
        )}
        {hasOpenOrder && (
          <p className="mt-1 text-xs text-amber-700">
            You already have a request open for this one.
          </p>
        )}
      </button>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Health checks &amp; screenings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          We tell you which tests are worth doing and why, and a doctor reads every result with
          you, including the all-clear ones.
        </p>

        {/* Who pays whom, and how much, is not stated here as a fixed fact —
            it is whatever is actually true for this patient in this state.
            See the note at the top of ReviewPrice. */}
        <ReviewPrice
          patientId={patientId}
          bundleCode={selected?.code ?? null}
          patientState={state}
          className="space-y-1 text-sm text-charcoal-ink/70"
        />

        {rebookDue && lastResulted && (
          <p className="rounded-md bg-soft-sage p-3 text-sm text-charcoal-ink">
            Your last check was{" "}
            {new Date(lastResulted.created_at).toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            })}
            , so it&apos;s about time for this year&apos;s. Numbers mean the most when there&apos;s
            last year&apos;s to compare against.
          </p>
        )}

        {openOrders.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
              Waiting on your result
            </p>
            {openOrders.map((order) =>
              order.status === "pending_payment" ? (
                <div key={order.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="amber">Ready to pay</Badge>
                    <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                  </div>
                  <p className="text-sm text-charcoal-ink">
                    {order.panel_bundle?.name ?? "Health check"}
                  </p>
                  <PayForLabOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                </div>
              ) : (
                <div key={order.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="blue">
                      {order.fulfilment === "partner" ? "Booked" : "Ready to take to a lab"}
                    </Badge>
                    <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                  </div>
                  <p className="text-sm text-charcoal-ink">
                    {order.panel_bundle?.name ?? "Health check"}
                  </p>
                  {order.fulfilment !== "partner" && (
                    <a
                      href={`/api/patient/lab-order/${order.id}/request`}
                      className="inline-block text-xs font-medium text-brand-green hover:underline"
                    >
                      Download the request to take with you
                    </a>
                  )}
                  <PatientResultUpload labOrderId={order.id} />
                </div>
              )
            )}
          </div>
        )}

        {screensEnabled ? (
          <>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
                Health Check packages
              </p>
              {packages.map(bundleRow)}
            </div>

            {confidential.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
                  Confidential screenings
                </p>
                <p className="text-xs text-charcoal-ink/60">
                  Recommended by the World Health Organization for everyone, and requested without
                  having to explain yourself to anybody.
                </p>
                <ConfidentialResultNotice />
                {confidential.map(bundleRow)}
              </div>
            )}

            {otherTests.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
                  Other self-service tests
                </p>
                <p className="text-xs text-charcoal-ink/60">
                  Request these directly: no due screening or doctor referral needed.
                </p>
                {otherTests.map(bundleRow)}
              </div>
            )}

            {selected && !openBundleIds.has(selected.id) && (
              <div className="space-y-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={createOrder.isPending || createPartnerOrder.isPending}
                  onClick={() =>
                    partnerBillingAvailable
                      ? createPartnerOrder.mutate({
                          organisationId,
                          patientId,
                          panelBundleId: selected.id,
                        })
                      : createOrder.mutate({
                          organisationId,
                          patientId,
                          panelBundleId: selected.id,
                        })
                  }
                >
                  {createOrder.isPending || createPartnerOrder.isPending
                    ? "Getting it ready…"
                    : `Get ${selected.name}`}
                </Button>
                {!partnerBillingAvailable && (
                  <p className="text-xs text-charcoal-ink/60">
                    Costs vary quite a bit between labs, so it&apos;s worth asking two before you go.
                  </p>
                )}
                {(createOrder.isError || createPartnerOrder.isError) && (
                  <p className="text-xs text-red-600">
                    Could not set that up just now. Please try again.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3 rounded-md border border-dashed border-charcoal-ink/15 p-3">
            <p className="text-sm text-charcoal-ink/70">
              The Health Check packages come with a paid plan. You can still upload any result you
              already have and a doctor will read it, on any plan.
            </p>
            <PatientResultUpload label="Upload a result you already have" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
