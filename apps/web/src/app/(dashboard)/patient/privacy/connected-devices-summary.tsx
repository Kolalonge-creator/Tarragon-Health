"use client";

import Link from "next/link";
import { useWearableConnections } from "@/lib/queries/wearable-connections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Read-only summary for the Privacy Centre — connecting/disconnecting a
 * device is a feature action that already lives on the Vitals page
 * (WearableConnectSection); this just shows what's currently sharing data
 * and links there to change it, rather than duplicating the connect UI.
 */
export function ConnectedDevicesSummary({ patientId }: { patientId: string }) {
  const connections = useWearableConnections(patientId);
  const active = connections.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected devices</CardTitle>
        <CardDescription>Services currently sharing data into your record.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No devices connected.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {active.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span className="capitalize text-charcoal-ink">{c.provider.replace(/_/g, " ")}</span>
                <span className="text-xs text-charcoal-ink/50">
                  Connected {c.connected_at ? formatDate(c.connected_at) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/patient/vitals" className="text-sm text-brand-green hover:underline">
          Manage device connections
        </Link>
      </CardContent>
    </Card>
  );
}
