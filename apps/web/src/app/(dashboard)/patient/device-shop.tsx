"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useDeviceCatalog,
  DEVICE_CATEGORY_LABEL,
  type DeviceCatalogEntry,
} from "@/lib/queries/device-catalog";
import { logDeviceAffiliateClick } from "./device-shop-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const CATEGORY_ORDER: DeviceCatalogEntry["category"][] = [
  "blood_pressure",
  "weight",
  "blood_glucose",
  "band",
];

/**
 * In-app Shop (Device Pairing & Integration Spec v2 §9.2) — third-party
 * devices Tarragon has clinically vetted, fulfilled via affiliate link-out.
 * Renders entirely from device_catalog; a device with no active + reviewed
 * row just doesn't appear (see the useDeviceCatalog query for why).
 */
export function DeviceShop() {
  const { data: catalogue, isLoading, isError } = useDeviceCatalog();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const byCategory = new Map<DeviceCatalogEntry["category"], DeviceCatalogEntry[]>();
  for (const device of catalogue ?? []) {
    const list = byCategory.get(device.category) ?? [];
    list.push(device);
    byCategory.set(device.category, list);
  }

  async function handleBuyNow(device: DeviceCatalogEntry) {
    if (!device.affiliate_link) return;
    setPendingId(device.id);
    try {
      await logDeviceAffiliateClick({
        deviceId: device.id,
        deviceName: device.device_name,
        category: device.category,
        affiliatePartner: device.affiliate_partner,
      });
    } finally {
      setPendingId(null);
      // Never capture payment/order data (spec §9.2) — the transaction is
      // entirely the retailer's, this just opens their checkout.
      window.open(device.affiliate_link, "_blank", "noopener");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2 pt-6 text-sm text-charcoal-ink/70">
          <p>
            These are third-party devices Tarragon has clinically vetted for accuracy and app
            compatibility — Tarragon doesn&apos;t sell or ship them itself. Buying one is entirely
            optional: you can log any reading by hand in Vitals &amp; symptoms at any time, with
            any device.
          </p>
          <p className="text-xs text-charcoal-ink/50">
            Tarragon earns a small commission when you buy through a &quot;Buy Now&quot; link
            below, at no extra cost to you. It never affects which devices we recommend — that is
            based on clinical accuracy and confirmed compatibility only.
          </p>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the device shop.</p>}
      {catalogue && catalogue.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-charcoal-ink/60">
            We&apos;re still finishing testing on our recommended devices — check back soon. In
            the meantime, log any reading by hand in{" "}
            <Link href="/patient/vitals" className="text-brand-green underline">
              Vitals &amp; symptoms
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {CATEGORY_ORDER.map((category) => {
        const devices = byCategory.get(category);
        if (!devices || devices.length === 0) return null;
        return (
          <div key={category} className="space-y-3">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-charcoal-ink/60">
              {DEVICE_CATEGORY_LABEL[category]}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {devices.map((device) => (
                <Card key={device.id}>
                  <CardHeader>
                    <CardTitle className="text-base">{device.device_name}</CardTitle>
                    {device.vendor_name && (
                      <p className="text-xs text-charcoal-ink/50">{device.vendor_name}</p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <span className="inline-flex items-center rounded-full bg-brand-green px-3 py-1 text-xs font-medium text-white">
                      ✅ Works with Tarragon
                    </span>
                    {device.description && (
                      <p className="text-sm text-charcoal-ink/70">{device.description}</p>
                    )}
                    {device.price_range_ngn && (
                      <p className="text-sm font-medium text-charcoal-ink">
                        {device.price_range_ngn}
                      </p>
                    )}
                    <Button
                      size="sm"
                      disabled={!device.affiliate_link || pendingId === device.id}
                      onClick={() => handleBuyNow(device)}
                    >
                      {pendingId === device.id ? "Opening…" : "Buy Now"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
