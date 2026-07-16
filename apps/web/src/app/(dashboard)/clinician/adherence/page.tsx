"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOrgAdherenceAlerts,
  useUpdateAdherenceAlert,
  type AdherenceAlertWithContext,
} from "@/lib/queries/adherence-alerts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function AlertRow({ alert }: { alert: AdherenceAlertWithContext }) {
  const update = useUpdateAdherenceAlert();
  const [note, setNote] = useState("");

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {alert.patient?.full_name ?? "Patient"}
          {alert.patient?.patient_number ? ` · ${alert.patient.patient_number}` : ""}
        </p>
        <Badge variant={alert.level === "doctor" ? "red" : "amber"}>
          {alert.level === "doctor" ? "Doctor review" : "Coach outreach"}
        </Badge>
        {alert.status === "acknowledged" && <Badge variant="blue">Acknowledged</Badge>}
      </div>
      <p className="text-xs text-charcoal-ink/70">
        {alert.medication?.drug_name ?? "Medication"} · {alert.missed_count} missed doses in the
        last {alert.window_days} days
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {alert.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate({ alertId: alert.id, status: "acknowledged" })}
          >
            Acknowledge
          </Button>
        )}
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Resolution note (e.g. dose adjusted, coached)"
          className="h-8 min-w-56 flex-1 text-xs"
        />
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ alertId: alert.id, status: "resolved", resolutionNote: note.trim() || null })
          }
        >
          Resolve
        </Button>
      </div>
      {update.isError && (
        <p className="text-xs text-red-600">
          {(update.error as Error).message || "Could not update this alert."}
        </p>
      )}
    </li>
  );
}

export default function AdherenceAlertsPage() {
  const { data, isLoading, isError } = useOrgAdherenceAlerts();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Adherence alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600">Could not load adherence alerts.</p>
          )}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              No open adherence alerts. Alerts are raised automatically when a patient
              repeatedly misses doses.
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
