"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveDeviceOfferings, usePatientMonitoredVitalTypes } from "@/lib/queries/device-offerings";
import { annotateWithRecommendation, type PatientDeviceType } from "@/lib/devices/recommend-devices";
import { koboToNaira } from "@tarragon/shared";

const DEVICE_TYPE_LABEL: Record<PatientDeviceType, string> = {
  bp_cuff: "Blood pressure monitors",
  glucometer: "Glucometers",
  scale: "Weight scales",
  thermometer: "Thermometers",
  pulse_oximeter: "Pulse oximeters",
};

/**
 * Buy-your-own device guidance. Tarragon doesn't sell or import devices (see
 * CLAUDE.md) — this links out to wherever each offering is actually sold.
 * Recommendation is advisory only: every active offering is shown and
 * buyable, condition-matched ones just carry a "Recommended for your care"
 * reason. Nothing here blocks a patient from buying any device.
 */
export function DeviceShopSection({ patientId }: { patientId: string }) {
  const { data: offerings, isLoading, isError } = useActiveDeviceOfferings();
  const { data: monitoredVitalTypes } = usePatientMonitoredVitalTypes(patientId);

  const grouped = useMemo(() => {
    const annotated = annotateWithRecommendation(offerings ?? [], monitoredVitalTypes ?? []);
    const groups = new Map<PatientDeviceType, typeof annotated>();
    for (const offering of annotated) {
      const list = groups.get(offering.device_type) ?? [];
      list.push(offering);
      groups.set(offering.device_type, list);
    }
    return [...groups.entries()];
  }, [offerings, monitoredVitalTypes]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Buy your own BP monitor, glucometer, or scale from any retailer below, then log
          readings manually or pair it if it&apos;s Bluetooth-enabled. Tarragon doesn&apos;t sell
          or ship devices itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the device shop.</p>}
        {offerings && offerings.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No devices listed yet — check back soon, or buy a BP monitor/glucometer from any
            local retailer and log readings manually in the meantime.
          </p>
        )}

        {grouped.map(([deviceType, items]) => (
          <div key={deviceType} className="space-y-2">
            <h3 className="text-sm font-semibold text-charcoal-ink">{DEVICE_TYPE_LABEL[deviceType]}</h3>
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-charcoal-ink">
                        {item.make} {item.model}
                      </span>
                      {item.recommendationReason && <Badge variant="green">Recommended for your care</Badge>}
                      {item.ble_validated && <Badge variant="blue">Bluetooth pairing tested</Badge>}
                    </div>
                    {item.recommendationReason && (
                      <p className="text-xs text-charcoal-ink/70">{item.recommendationReason}</p>
                    )}
                    <p className="text-xs text-charcoal-ink/50">
                      {item.retailer_name ? `${item.retailer_name}` : "Third-party retailer"}
                      {item.price_kobo != null && ` · from ₦${koboToNaira(item.price_kobo).toLocaleString()}`}
                    </p>
                  </div>
                  {item.affiliate_url && (
                    <Button asChild size="sm" variant="outline">
                      <a href={item.affiliate_url} target="_blank" rel="noopener noreferrer">
                        Buy
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
