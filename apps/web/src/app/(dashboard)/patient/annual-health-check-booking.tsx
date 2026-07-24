"use client";

import { useMemo, useState } from "react";
import {
  useLabCatalogue,
  useCreateLabOrder,
  usePatientLabOrders,
  type PanelBundle,
} from "@/lib/queries/lab-orders";
import type { FacilityWithServices } from "@/lib/queries/facilities";
import { FacilitySelector, type PatientLocation } from "./facility-selector";
import { RegionGate } from "@/components/region-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";
import { PayWithWalletButton } from "@/components/pay-with-wallet-button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";
import { cn } from "@/lib/utils";

const OPEN_STATUSES = [
  "pending_payment",
  "payment_confirmed",
  "ordered",
  "sample_collected",
  "processing",
];

/** Health Check packages vs confidential single screenings — both are the
 * self_bookable set (WHO-essential only, per migration 20260723164727). */
const isPackage = (b: PanelBundle) =>
  b.code === "annual_health_check" || b.code.startsWith("health_check");

/** The WHO-essential confidential screenings (cervical smear, HIV, Hep B,
 * Hep C) vs. other self-bookable single tests (e.g. blood group & genotype,
 * migration 20260724020715) that don't carry the same privacy framing. */
const CONFIDENTIAL_CODES = ["single_cervical_smear", "single_hiv", "single_hep_b", "single_hep_c"];
const isConfidential = (b: PanelBundle) => CONFIDENTIAL_CODES.includes(b.code);

const REBOOK_AFTER_MONTHS = 11;

/**
 * Self-service booking for the WHO-essential self_bookable bundles: the
 * three Health Check packages (Basic / Annual / Comprehensive) and the
 * confidential single screenings (cervical smear, HIV, Hepatitis B). Open to
 * every patient on every plan — BOOK & PAY items, not subscription features.
 * The DB trigger (private.enforce_lab_order_origin) is the real gate; this
 * card only ever offers what panel_bundles.self_bookable allows. Every
 * resulted check gets a doctor debrief (see handle_health_check_resulted).
 */
export function AnnualHealthCheckBooking({
  patientId,
  organisationId,
  patientLocation,
  sex,
}: {
  patientId: string;
  organisationId: string | null;
  patientLocation?: PatientLocation | null;
  /** Hides sex-specific single screenings (e.g. cervical smear for men). */
  sex?: string | null;
}) {
  const { data: bundles } = useLabCatalogue();
  const { data: orders } = usePatientLabOrders(patientId);
  const createOrder = useCreateLabOrder();
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState<FacilityWithServices | null>(null);
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
    packages.find((b) => b.code === "annual_health_check") ??
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
        onClick={() => {
          setSelectedBundleId(bundle.id);
          setBooking(false);
          setSelectedFacility(null);
        }}
        className={cn(
          "w-full rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green",
          isSelected ? "border-brand-green bg-brand-green/5" : "border-charcoal-ink/10 hover:border-charcoal-ink/25",
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
          <p className="mt-1 text-xs text-amber-700">You already have this one in progress.</p>
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
          Book directly, on any plan — you see the exact price before you pay, and a doctor
          reviews every result with you, including the all-clear ones.
        </p>

        {rebookDue && lastResulted && (
          <p className="rounded-md bg-soft-sage p-3 text-sm text-charcoal-ink">
            Your last check was{" "}
            {new Date(lastResulted.created_at).toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            })}{" "}
            — it&apos;s about time for this year&apos;s. Numbers mean the most when there&apos;s
            last year&apos;s to compare against.
          </p>
        )}

        {openOrders.length > 0 && (
          <div className="space-y-2">
            {openOrders.map((order) => (
              <div key={order.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={order.status === "pending_payment" ? "amber" : "blue"}>
                    {order.status === "pending_payment" ? "Awaiting payment" : "In progress"}
                  </Badge>
                  <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                </div>
                <p className="text-sm text-charcoal-ink">
                  {order.panel_bundle?.name ?? "Health check"}
                  {order.provider && (
                    <span className="text-charcoal-ink/60"> · {order.provider.name}</span>
                  )}{" "}
                  — ₦{koboToNaira(order.total_kobo).toLocaleString()}
                </p>
                {order.status === "pending_payment" && (
                  <>
                    <PayForLabOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                    <PayWithWalletButton
                      orderType="lab"
                      orderId={order.id}
                      amountKobo={order.total_kobo}
                      patientId={patientId}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <RegionGate
          state={patientLocation?.state ?? null}
          service="lab"
          serviceLabel="Health check booking"
        >
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
                Recommended by the World Health Organization for everyone — booked privately,
                results shared only with you and the reviewing doctor.
              </p>
              {confidential.map(bundleRow)}
            </div>
          )}

          {otherTests.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
                Other self-service tests
              </p>
              <p className="text-xs text-charcoal-ink/60">
                Book directly — no due screening or doctor referral needed.
              </p>
              {otherTests.map(bundleRow)}
            </div>
          )}

          {selected && !openBundleIds.has(selected.id) && (
            <div className="pt-1">
              {booking ? (
                <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
                  <p className="text-xs font-medium text-charcoal-ink">
                    Choose a lab near you for: {selected.name}
                  </p>
                  <FacilitySelector
                    type="lab"
                    patientLocation={patientLocation}
                    selectedFacilityId={selectedFacility?.id ?? null}
                    onSelect={setSelectedFacility}
                    idPrefix="ahc"
                    emptyText="No labs listed for that location yet — try a nearby city, or message your care team to arrange it."
                  />
                  {selectedFacility && !selectedFacility.lab_provider_id && (
                    <p className="text-xs text-amber-700">
                      This location can&apos;t take an online booking yet — pick another lab.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!selectedFacility?.lab_provider_id || createOrder.isPending}
                      onClick={() =>
                        createOrder.mutate(
                          {
                            organisationId,
                            patientId,
                            panelBundleId: selected.id,
                            providerId: selectedFacility!.lab_provider_id!,
                            facilityId: selectedFacility!.id,
                            totalKobo: selected.price_kobo,
                          },
                          {
                            onSuccess: () => {
                              setBooking(false);
                              setSelectedFacility(null);
                            },
                          }
                        )
                      }
                    >
                      {createOrder.isPending
                        ? "Booking…"
                        : `Confirm — ₦${koboToNaira(selected.price_kobo).toLocaleString()}`}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setBooking(false);
                        setSelectedFacility(null);
                      }}
                    >
                      Cancel
                    </Button>
                    {createOrder.isError && (
                      <p className="w-full text-xs text-red-600">Could not book. Try again.</p>
                    )}
                  </div>
                </div>
              ) : (
                <Button type="button" size="sm" onClick={() => setBooking(true)}>
                  Book {selected.name} — ₦{koboToNaira(selected.price_kobo).toLocaleString()}
                </Button>
              )}
            </div>
          )}
        </RegionGate>
      </CardContent>
    </Card>
  );
}
