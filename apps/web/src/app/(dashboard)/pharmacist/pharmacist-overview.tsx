"use client";

import Link from "next/link";
import { NAV_ICON, SEMANTIC_ICON } from "@/lib/icons";
import {
  usePharmacistOrders,
  usePharmacistDispenseHistory,
  usePharmacistProfile,
} from "@/lib/queries/pharmacist";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { isOpenStatus, isAwaitingStatus } from "./_lib/order-status";
import { itemsSummary, type PharmacistOrderRow } from "./_lib/items";
import { formatRequestedAt, isLagosToday } from "./_lib/format";

function licenseExpiryColor(expiresAt: string | null): string {
  if (!expiresAt) return "text-charcoal-ink";
  const days = Math.round((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return days < 60 ? "text-amber-700" : "text-charcoal-ink";
}

export function PharmacistOverview() {
  const { data: orders, isLoading: ordersLoading } = usePharmacistOrders();
  const { data: dispenses, isLoading: dispensesLoading } = usePharmacistDispenseHistory();
  const { data: profile, isLoading: profileLoading } = usePharmacistProfile();

  const rows = (orders ?? []) as PharmacistOrderRow[];
  const openOrders = rows.filter((o) => isOpenStatus(o.status));
  const awaitingOrders = rows.filter((o) => isAwaitingStatus(o.status));
  const inProgressOrders = rows.filter((o) => o.status === "confirmed");
  const dispensedToday = (dispenses ?? []).filter((d) => isLagosToday(d.dispensed_on));
  const awaitingSnapshot = openOrders.slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={NAV_ICON.team}
          tintClassName="bg-amber-100"
          iconClassName="text-amber-700"
          label="Orders awaiting"
          value={ordersLoading ? "—" : String(awaitingOrders.length)}
        />
        <StatTile
          icon={SEMANTIC_ICON.logistics}
          tintClassName="bg-blue-100"
          iconClassName="text-blue-700"
          label="In progress"
          value={ordersLoading ? "—" : String(inProgressOrders.length)}
        />
        <StatTile
          icon={SEMANTIC_ICON.medication}
          tintClassName="bg-green-100"
          iconClassName="text-green-700"
          label="Dispensed today"
          value={dispensesLoading ? "—" : String(dispensedToday.length)}
        />
        <StatTile
          icon={SEMANTIC_ICON.pharmacy}
          iconTint="ivory"
          label="Total open orders"
          value={ordersLoading ? "—" : String(openOrders.length)}
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
          {ordersLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {!ordersLoading && awaitingSnapshot.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No orders waiting — you&apos;re caught up.</p>
          )}
          {awaitingSnapshot.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {awaitingSnapshot.map((o) => (
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
            {dispensesLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
            {!dispensesLoading && dispensedToday.length === 0 && (
              <p className="text-sm text-charcoal-ink/60">Nothing dispensed yet today.</p>
            )}
            {dispensedToday.length > 0 && (
              <ul className="divide-y divide-charcoal-ink/10">
                {dispensedToday.slice(0, 3).map((d) => (
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
            {profileLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
            {!profileLoading && !profile && (
              <p className="text-sm text-charcoal-ink/60">No pharmacy profile on file yet.</p>
            )}
            {profile && (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-charcoal-ink/55">Regions covered</dt>
                  <dd className="font-medium text-charcoal-ink">
                    {profile.regions.length > 0 ? profile.regions.join(", ") : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-charcoal-ink/55">Delivery</dt>
                  <dd className="font-medium text-charcoal-ink">{profile.delivery ? "Yes" : "No"}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-charcoal-ink/55">License</dt>
                  <dd className="font-medium text-charcoal-ink">{profile.license_number ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-charcoal-ink/55">Expires</dt>
                  <dd className={`font-medium ${licenseExpiryColor(profile.license_expires_at)}`}>
                    {profile.license_expires_at
                      ? new Date(profile.license_expires_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
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
