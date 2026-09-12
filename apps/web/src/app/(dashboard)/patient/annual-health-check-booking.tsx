"use client";

import { useMemo, useState } from "react";
import {
  useLabCatalogue,
  useCreateLabOrder,
  usePatientLabOrders,
  type PanelBundle,
} from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { EcgReportUpload } from "@/components/ecg-report-upload";
import { LabOrderTestChecklist } from "@/components/lab-order-test-checklist";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";
import { RedeemVoucherButton } from "@/components/redeem-voucher-button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ReviewPrice } from "./review-price";
import { cn } from "@/lib/utils";
import { LabSpecimenTracker } from "@/components/lab-specimen-tracker";
import { useScreenTypeDetails } from "@/lib/queries/lab-orders";

/** An order still waiting on the patient going to a lab and uploading. */
const OPEN_STATUSES = ["payment_confirmed", "ordered", "sample_collected", "processing"];

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
const CONFIDENTIAL_CODES = [
  "single_cervical_smear",
  "single_hiv",
  "single_hep_b",
  "single_hep_c",
  "blood_borne_virus_screen",
];
const isConfidential = (b: PanelBundle) => CONFIDENTIAL_CODES.includes(b.code);

const REBOOK_AFTER_MONTHS = 11;

/**
 * The Screen ladder — self-arranged only. `panel_bundles.guidance_only` is
 * `true` for every bundle as of migration `20260910011846_catalogue_
 * becomes_guidance_not_commerce.sql`: Tarragon no longer bills for or books
 * any test, full stop, and `private.enforce_guidance_only_is_never_billed`
 * refuses a partner-billed lab_orders insert at the database level
 * regardless of what the UI does. There used to be a second, partner-billed
 * fulfilment mode here (Synlab Nigeria, switched on 2026-08-21) — that
 * branch was removed 2026-09-11 once it became clear the DB had already cut
 * it off from underneath the UI, leaving the "Book & pay" button silently
 * broken (a doomed insert behind a generic error).
 *
 * Every bundle now works the same way: `useCreateLabOrder` opens a request
 * at `status: 'ordered'` with no charge, the patient takes the printed
 * request (auto-opened right after) to any laboratory they choose and pays
 * that lab directly, then uploads the result here for a doctor to read.
 * "Waiting on payment" below still exists to settle any pre-existing
 * partner-billed order from before this cutover — it is not a live booking
 * path any more.
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
  /** Nigerian state, passed through to ReviewPrice for its own copy. */
  state?: string | null;
  screensEnabled?: boolean;
}) {
  const { data: bundles } = useLabCatalogue();
  const { data: orders } = usePatientLabOrders(patientId);
  const createOrder = useCreateLabOrder();
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
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
  // A self-arranged order can never reach pending_payment — the DB trigger
  // refuses it (private.enforce_lab_order_origin) — so every row here is a
  // partner-billed review Tarragon booked and is waiting to be paid for,
  // whether from this session's own checkout redirect not completing, or a
  // provider failure after the order was created.
  const pendingPaymentOrders = myOrders.filter((o) => o.status === "pending_payment");
  const openBundleIds = new Set(
    [...openOrders, ...pendingPaymentOrders].map((o) => o.panel_bundle_id)
  );

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

  // §56.4/§56.6: prep/specimen detail for the first test in the selected
  // bundle — a multi-test panel can mix specimen types, so this is
  // orientation ("mostly a blood draw, fasting required"), not a
  // guarantee every line item shares it.
  const { data: selectedTestDetails } = useScreenTypeDetails(selected?.test_codes[0] ?? null);

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
            : "border-charcoal-ink/10 dark:border-night-ink/15 hover:border-charcoal-ink/25 dark:hover:border-night-ink/30",
          hasOpenOrder && "opacity-60"
        )}
      >
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{bundle.name}</p>
        {bundle.description && (
          <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{bundle.description}</p>
        )}
        {hasOpenOrder && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
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
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Health checks &amp; screenings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
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
          className="space-y-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70"
        />

        {rebookDue && lastResulted && (
          <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 p-3 text-sm text-charcoal-ink dark:text-night-ink">
            Your last check was{" "}
            {new Date(lastResulted.created_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
              month: "long",
              year: "numeric",
            })}
            , so it&apos;s about time for this year&apos;s. Numbers mean the most when there&apos;s
            last year&apos;s to compare against.
          </p>
        )}

        {pendingPaymentOrders.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
              Waiting on payment
            </p>
            {pendingPaymentOrders.map((order) => (
              <div key={order.id} className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="amber">Not yet paid</Badge>
                  <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{order.order_number}</span>
                </div>
                <p className="text-sm text-charcoal-ink dark:text-night-ink">
                  {order.panel_bundle?.name ?? "Health check"}
                </p>
                {/* A prepaid Care Voucher for this exact bundle — bought by the
                    patient themselves or gifted by someone supporting their
                    care (see supabase/migrations/20260731215226 and the
                    diaspora gift flow) — settles this order without a card.
                    voucherCoversOrder does the real matching; this only
                    offers the button when one actually applies. */}
                <RedeemVoucherButton
                  orderType="lab"
                  orderId={order.id}
                  patientId={patientId}
                  panelBundleId={order.panel_bundle_id}
                  payableKobo={order.payable_kobo ?? order.total_kobo}
                />
                <PayForLabOrderButton
                  orderId={order.id}
                  amountKobo={order.payable_kobo ?? order.total_kobo}
                  totalKobo={order.total_kobo}
                />
              </div>
            ))}
          </div>
        )}

        {openOrders.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
              Waiting on your result
            </p>
            {openOrders.map((order) => {
              const testCodes = order.panel_bundle?.test_codes ?? [];
              const includesEcg = testCodes.includes("ecg_resting");
              const isMultiTest = testCodes.length > 1;
              return (
                <div key={order.id} className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="blue">Ready to take to a lab</Badge>
                    <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{order.order_number}</span>
                  </div>
                  <p className="text-sm text-charcoal-ink dark:text-night-ink">
                    {order.panel_bundle?.name ?? "Health check"}
                  </p>
                  {order.fulfilment === "self_arranged" && (
                    <a
                      href={`/api/patient/lab-order/${order.id}/request`}
                      className="inline-block text-xs font-medium text-brand-green dark:text-brand-green-bright hover:underline"
                    >
                      Print the request to take with you
                    </a>
                  )}
                  <LabSpecimenTracker labOrderId={order.id} />
                  {isMultiTest ? (
                    <LabOrderTestChecklist labOrderId={order.id} testCodes={testCodes} />
                  ) : (
                    <>
                      <PatientResultUpload
                        labOrderId={order.id}
                        label={includesEcg ? "Upload your blood/lab results" : "Upload your result"}
                      />
                      {includesEcg && <EcgReportUpload labOrderId={order.id} label="Upload your 12-lead ECG" />}
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
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
                Health Check packages
              </p>
              {packages.map(bundleRow)}
            </div>

            {confidential.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
                  Confidential screenings
                </p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  Recommended by the World Health Organization for everyone, and requested without
                  having to explain yourself to anybody.
                </p>
                <ConfidentialResultNotice />
                {confidential.map(bundleRow)}
              </div>
            )}

            {otherTests.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
                  Other self-service tests
                </p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  Request these directly: no due screening or doctor referral needed.
                </p>
                {otherTests.map(bundleRow)}
              </div>
            )}

            {selected && !openBundleIds.has(selected.id) && (
              <div className="space-y-2 pt-1">
                {selectedTestDetails?.specimen_type && (
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    <span className="font-medium text-charcoal-ink dark:text-night-ink">Sample needed: </span>
                    {selectedTestDetails.specimen_type}
                    {selectedTestDetails.preparation_instructions
                      ? `. ${selectedTestDetails.preparation_instructions}`
                      : ""}
                  </p>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={createOrder.isPending}
                  onClick={() => {
                    setPrintError(null);
                    createOrder.mutate(
                      { organisationId, patientId, panelBundleId: selected.id },
                      {
                        onSuccess: (order) => {
                          if (!order?.id) return;
                          const win = window.open(`/api/patient/lab-order/${order.id}/request`, "_blank");
                          if (!win) {
                            setPrintError(
                              "Your request is ready below under “Waiting on your result” — your browser blocked the automatic print, so use the link there instead."
                            );
                          }
                        },
                      }
                    );
                  }}
                >
                  {createOrder.isPending ? "Getting your form ready…" : `Get & print ${selected.name}`}
                </Button>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  We&apos;ll open a printable request listing exactly what&apos;s needed. Take it to
                  any laboratory you like and pay them directly; costs vary quite a bit between
                  labs, so it&apos;s worth asking two before you go.
                </p>
                {createOrder.isError && (
                  <p className="text-xs text-red-600 dark:text-red-300">
                    Could not set that up just now. Please try again.
                  </p>
                )}
                {printError && <p className="text-xs text-amber-700 dark:text-amber-300">{printError}</p>}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3 rounded-md border border-dashed border-charcoal-ink/15 dark:border-night-ink/20 p-3">
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              The Health Check packages come with a paid plan. You can still upload any result you
              already have and a doctor will read it, on any plan.
            </p>
            <PatientResultUpload label="Upload a result you already have" patientId={patientId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
