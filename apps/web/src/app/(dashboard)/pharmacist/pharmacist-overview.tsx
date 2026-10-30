"use client";

import Link from "next/link";
import { Clock4, Truck, Pill, ShoppingBag } from "lucide-react";
import {
  usePharmacistOrders,
  usePharmacistDispenseHistory,
  usePharmacistProfile,
} from "@/lib/queries/pharmacist";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { itemsSummary, type PharmacistOrderRow } from "./_lib/items";
import { formatRequestedAt } from "./_lib/format";
import { buildPharmacistOverview } from "./_lib/overview-summary";
import { pharmacistFirstView } from "./_lib/first-view";
import { PharmacistFirst } from "./pharmacist-first";

const LICENCE_TONE_CLASS = {
  ok: "text-charcoal-ink",
  soon: "text-amber-700",
  expired: "text-red-700",
} as const;

export function PharmacistOverview() {
  const orders = usePharmacistOrders();
  const dispenses = usePharmacistDispenseHistory();
  const profile = usePharmacistProfile();

  // A figure that has not loaded, or failed to, is never shown as zero or as
  // "caught up" (see _lib/overview-summary.ts).
  const view = buildPharmacistOverview({
    orders: {
      data: orders.data as PharmacistOrderRow[] | undefined,
      isLoading: orders.isLoading,
      isError: orders.isError,
    },
    dispenses: { data: dispenses.data, isLoading: dispenses.isLoading, isError: dispenses.isError },
    profile: { data: profile.data, isLoading: profile.isLoading, isError: profile.isError },
  });
  const { tiles } = view.orders;
  const first = pharmacistFirstView(view);

  return (
    <div className="flex flex-col gap-5">
      <PharmacistFirst view={first} />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Clock4}
          tintClassName="bg-amber-100"
          iconClassName="text-amber-700"
          label="Orders awaiting"
          {...tiles.awaiting}
        />
        <StatTile
          icon={Truck}
          tintClassName="bg-blue-100"
          iconClassName="text-blue-700"
          label="In progress"
          {...tiles.inProgress}
        />
        <StatTile
          icon={Pill}
          tintClassName="bg-green-100"
          iconClassName="text-green-700"
          label="Dispensed today"
          {...view.dispenses.tile}
        />
        <StatTile
          icon={ShoppingBag}
          iconTint="ivory"
          label="Total open orders"
          {...tiles.open}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Orders needing action</CardTitle>
          <Link href="/pharmacist/orders" className="text-sm font-semibold text-brand-green hover:text-deep-forest">
            Open orders →
          </Link>
        </CardHeader>
        <CardContent>
          {view.orders.state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {view.orders.state === "failed" && (
            <LoadFailure>
              Your orders could not be loaded. This does not mean there are none waiting. Reload the
              page to try again.
            </LoadFailure>
          )}
          {view.orders.state === "stale" && (
            <StaleDataNotice className="mb-3">
              These orders may be out of date: the last refresh failed. New orders may be waiting.
              Reload the page to try again.
            </StaleDataNotice>
          )}
          {view.orders.caughtUp && (
            <p className="text-sm text-charcoal-ink/60">No orders waiting. You&apos;re caught up.</p>
          )}
          {view.orders.snapshot.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {view.orders.snapshot.map((o) => (
                <li key={o.order_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-charcoal-ink">{o.patient_name ?? "Patient"}</span>
                    <span className="ml-1.5 text-charcoal-ink/50">{itemsSummary(o.items)}</span>
                  </div>
                  <span className="shrink-0 text-xs text-charcoal-ink/50">{formatRequestedAt(o.requested_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dispensed today</CardTitle>
          </CardHeader>
          <CardContent>
            {view.dispenses.state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
            {view.dispenses.state === "failed" && (
              <LoadFailure>
                Your dispensing history could not be loaded. This does not mean nothing was dispensed
                today. Reload the page to try again.
              </LoadFailure>
            )}
            {view.dispenses.state === "stale" && (
              <StaleDataNotice className="mb-3">
                This list may be out of date: the last refresh failed. Reload the page to try again.
              </StaleDataNotice>
            )}
            {view.dispenses.nothingYet && (
              <p className="text-sm text-charcoal-ink/60">Nothing dispensed yet today.</p>
            )}
            {view.dispenses.today.length > 0 && (
              <ul className="divide-y divide-charcoal-ink/10">
                {view.dispenses.today.slice(0, 3).map((d) => (
                  <li key={d.dispense_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-charcoal-ink">{d.patient_name ?? "Patient"}</span>
                      <span className="ml-1.5 text-charcoal-ink/50">{d.drug_name}</span>
                    </div>
                    <span className="shrink-0 text-xs text-charcoal-ink/50">
                      {d.quantity ? `× ${d.quantity}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Pharmacy status</CardTitle>
            <Link href="/pharmacist/profile" className="text-sm font-semibold text-brand-green hover:text-deep-forest">
              Manage →
            </Link>
          </CardHeader>
          <CardContent>
            {view.profile.state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
            {view.profile.state === "failed" && (
              <LoadFailure>
                Your pharmacy details could not be loaded. This does not mean no profile is on file.
                Reload the page to try again.
              </LoadFailure>
            )}
            {view.profile.state === "stale" && (
              <StaleDataNotice className="mb-3">
                These details may be out of date: the last refresh failed. Reload the page to try again.
              </StaleDataNotice>
            )}
            {view.profile.kind === "none" && (
              <p className="text-sm text-charcoal-ink/60">No pharmacy profile on file yet.</p>
            )}
            {view.profile.kind === "ready" && (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-charcoal-ink/55">Regions covered</dt>
                  <dd className="font-medium text-charcoal-ink">{view.profile.regions}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-charcoal-ink/55">Licence</dt>
                  <dd className="font-medium text-charcoal-ink">{view.profile.licence}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-charcoal-ink/55">Expires</dt>
                  <dd className={`font-medium ${LICENCE_TONE_CLASS[view.profile.expires.tone]}`}>
                    {view.profile.expires.text}
                    {view.profile.expires.note && (
                      <span className="ml-1.5 text-xs font-semibold">({view.profile.expires.note})</span>
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
