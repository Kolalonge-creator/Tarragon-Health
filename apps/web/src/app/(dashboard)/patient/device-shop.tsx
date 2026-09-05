"use client";

import {
  useDeviceCatalog,
  DEVICE_CATEGORY_LABEL,
  type DeviceCatalogEntry,
} from "@/lib/queries/device-catalog";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CATEGORY_ORDER: DeviceCatalogEntry["category"][] = [
  "blood_pressure",
  "weight",
  "blood_glucose",
  "band",
];

/**
 * In-app device recommendations (Device Pairing & Integration Spec v2 §9.2) —
 * third-party devices Tarragon has clinically vetted, shown as a plain
 * recommendation with no purchase link or commission (2026-08-26: the
 * affiliate link-out was removed — Jumia/Konga have no workable affiliate
 * programme for these categories, and a direct-manufacturer/international
 * link exposes a Nigerian patient to import duty). Patients buy from
 * whatever local retailer they already use. Renders entirely from
 * device_catalog; a device with no active + reviewed row just doesn't
 * appear (see the useDeviceCatalog query for why).
 */
export function DeviceShop() {
  const { data: catalogue, isLoading, isError } = useDeviceCatalog();

  const byCategory = new Map<DeviceCatalogEntry["category"], DeviceCatalogEntry[]>();
  for (const device of catalogue ?? []) {
    const list = byCategory.get(device.category) ?? [];
    list.push(device);
    byCategory.set(device.category, list);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2 pt-6 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          <p>
            These are third-party devices Tarragon has clinically vetted for accuracy and app
            compatibility. Tarragon doesn&apos;t sell or ship them itself, and doesn&apos;t earn
            anything if you buy one. Get one from any retailer you trust, or log any reading by
            hand in Vitals &amp; symptoms at any time, with any device.
          </p>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
      {isError && <p className="text-sm text-red-600 dark:text-red-300">Could not load device recommendations.</p>}
      {catalogue && catalogue.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            We&apos;re still finishing testing on our recommended devices. Check back soon. In
            the meantime, log any reading by hand in{" "}
            <Link href="/patient/vitals" className="text-brand-green dark:text-brand-green-bright underline">
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
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
              {DEVICE_CATEGORY_LABEL[category]}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {devices.map((device) => (
                <Card key={device.id}>
                  <CardHeader>
                    <CardTitle className="text-base">{device.device_name}</CardTitle>
                    {device.vendor_name && (
                      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{device.vendor_name}</p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <span className="inline-flex items-center rounded-full bg-brand-green px-3 py-1 text-xs font-medium text-white">
                      ✅ Works with Tarragon
                    </span>
                    {device.description && (
                      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{device.description}</p>
                    )}
                    {device.price_range_ngn && (
                      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                        {device.price_range_ngn}
                      </p>
                    )}
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
