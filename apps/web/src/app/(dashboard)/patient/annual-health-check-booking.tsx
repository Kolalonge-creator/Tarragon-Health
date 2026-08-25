"use client";

import { useMemo, useState } from "react";
import {
  useLabCatalogue,
  useCreateLabOrder,
  usePatientLabOrders,
  type PanelBundle,
} from "@/lib/queries/lab-orders";
import type { PatientLocation } from "./facility-selector";
import { ChooseLabFacility } from "./choose-lab-facility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";
import { RedeemVoucherButton } from "@/components/redeem-voucher-button";
import { HomeCollectionAvailability } from "@/components/home-collection-availability";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira, type LabOrderStatus } from "@tarragon/shared";
import { cn } from "@/lib/utils";

/** An order still waiting on some patient or lab action before its result lands. */
const OPEN_STATUSES: LabOrderStatus[] = [
  "pending_payment",
  "payment_confirmed",
  "ordered",
  "sample_collected",
  "processing",
];

const STATUS_BADGE: Partial<Record<LabOrderStatus, { variant: BadgeProps["variant"]; label: string }>> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Booking confirmed" },
  ordered: { variant: "blue", label: "In progress" },
  sample_collected: { variant: "blue", label: "Sample collected" },
  processing: { variant: "blue", label: "In progress" },
};

/** Restored 2026-08-25 alongside the partner-lab fulfilment: any still-open
 * order booked before then (fulfilment='self_arranged') keeps its original
 * "take this to a lab yourself" labels and actions rather than being forced
 * into a facility/payment flow the order was never billed for. */
const SELF_ARRANGED_STATUS_LABEL: Partial<Record<LabOrderStatus, string>> = {
  payment_confirmed: "Ready to take to a lab",
  ordered: "Ready to take to a lab",
};

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
 * The Screen ladder, partner-fulfilled (restored 2026-08-25): Tarragon books
 * the chosen bundle with Synlab Nigeria and bills the patient for it, rather
 * than the patient paying a lab directly. Selecting and confirming a bundle
 * here opens a 'pending_payment' order — a DB trigger (private.
 * set_lab_order_computed_price) prices it from screen_types' contracted list
 * for exactly what this patient is due and resolves Synlab as the provider,
 * not this component; the order then walks through an optional facility
 * choice (or home collection), payment, and finally sample collection,
 * tracked in the "waiting on your result" list below.
 *
 * `screensEnabled` gates the curated ladder as a subscription feature. What is
 * NEVER gated, on any plan: uploading a result, a doctor reading it, and the
 * abnormal-result escalation pipeline. Safety is not a paid feature here.
 */
export function AnnualHealthCheckBooking({
  patientId,
  organisationId,
  patientLocation,
  sex,
  screensEnabled = true,
}: {
  patientId: string;
  organisationId: string | null;
  patientLocation?: PatientLocation | null;
  /** Hides sex-specific single screenings (e.g. cervical smear for men). */
  sex?: string | null;
  screensEnabled?: boolean;
}) {
  const { data: bundles } = useLabCatalogue();
  const { data: orders } = usePatientLabOrders(patientId);
  const createOrder = useCreateLabOrder();
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
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
          <p className="shrink-0 text-sm font-semibold text-charcoal-ink">
            ₦{koboToNaira(bundle.price_kobo).toLocaleString()}
          </p>
        </div>
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
          We tell you which tests are worth doing and why. We&apos;ll book it with Synlab Nigeria
          and bill you for it: confirm a facility (or leave it for home collection) and pay from
          your open requests below, then a doctor reads every result with you, including the
          all-clear ones.
        </p>

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
            {openOrders.map((order) => {
              const isSelfArranged = order.fulfilment === "self_arranged";
              const badge = STATUS_BADGE[order.status] ?? { variant: "blue" as const, label: "In progress" };
              const label = (isSelfArranged && SELF_ARRANGED_STATUS_LABEL[order.status]) || badge.label;

              return (
                <div key={order.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant}>{label}</Badge>
                    <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                  </div>
                  <p className="text-sm text-charcoal-ink">
                    {order.panel_bundle?.name ?? "Health check"}
                    {!isSelfArranged && (
                      <span className="text-charcoal-ink/60">
                        {" "}
                        · ₦{koboToNaira(order.total_kobo).toLocaleString()}
                      </span>
                    )}
                  </p>

                  {isSelfArranged ? (
                    // Dormant path: kept only for an order booked before the
                    // 2026-08-25 partner-lab restore. Nothing here creates a
                    // new self-arranged lab order any more.
                    (order.status === "payment_confirmed" || order.status === "ordered") && (
                      <>
                        <a
                          href={`/api/patient/lab-order/${order.id}/request`}
                          className="inline-block text-xs font-medium text-brand-green hover:underline"
                        >
                          Download the request to take with you
                        </a>
                        <PatientResultUpload labOrderId={order.id} />
                      </>
                    )
                  ) : (
                    <>
                      {order.status === "pending_payment" &&
                        (order.facility_id ? (
                          <>
                            <PayForLabOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                            <RedeemVoucherButton
                              orderType="lab"
                              orderId={order.id}
                              patientId={patientId}
                              panelBundleId={order.panel_bundle_id}
                              payableKobo={order.payable_kobo ?? order.total_kobo}
                            />
                          </>
                        ) : (
                          <ChooseLabFacility
                            orderId={order.id}
                            patientId={patientId}
                            patientLocation={patientLocation}
                          />
                        ))}
                      {(order.status === "payment_confirmed" || order.status === "ordered") && (
                        <>
                          <HomeCollectionAvailability
                            region={order.provider?.regions?.[0] ?? null}
                            homeVisitProviderName={order.home_visit_provider?.name ?? null}
                            homeVisitScheduledAt={order.home_visit_scheduled_at}
                          />
                          <PatientResultUpload labOrderId={order.id} />
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
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
                  disabled={createOrder.isPending}
                  onClick={() =>
                    createOrder.mutate({
                      organisationId,
                      patientId,
                      panelBundleId: selected.id,
                    })
                  }
                >
                  {createOrder.isPending
                    ? "Getting it ready…"
                    : `Get ${selected.name}: up to ₦${koboToNaira(selected.price_kobo).toLocaleString()}`}
                </Button>
                {createOrder.isError && (
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
