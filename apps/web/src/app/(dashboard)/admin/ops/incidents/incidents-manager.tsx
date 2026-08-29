"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type OpsIncidentCategory =
  | "clinical"
  | "technical"
  | "privacy"
  | "security"
  | "financial"
  | "operational";
export type OpsIncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";
export type OpsIncidentStatus = "open" | "investigating" | "mitigated" | "resolved" | "closed";

export type OpsIncidentRow = {
  id: string;
  reference: string;
  category: OpsIncidentCategory;
  severity: OpsIncidentSeverity;
  status: OpsIncidentStatus;
  title: string;
  summary: string | null;
  detected_at: string;
  ack_due_at: string;
  resolve_due_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  owner_id: string | null;
  requires_regulatory_notification: boolean;
};

const SEVERITY_VARIANT: Record<OpsIncidentSeverity, "red" | "amber" | "blue" | "grey"> = {
  sev1: "red",
  sev2: "amber",
  sev3: "blue",
  sev4: "grey",
};

const STATUS_LABEL: Record<OpsIncidentStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  mitigated: "Mitigated",
  resolved: "Resolved",
  closed: "Closed",
};

const CATEGORY_LABEL: Record<OpsIncidentCategory, string> = {
  clinical: "Clinical",
  technical: "Technical",
  privacy: "Privacy",
  security: "Security",
  financial: "Financial",
  operational: "Operational",
};

function isPastSla(row: OpsIncidentRow): boolean {
  if (row.status === "closed") return false;
  const now = Date.now();
  if (!row.acknowledged_at && new Date(row.ack_due_at).getTime() < now) return true;
  if (!row.resolved_at && new Date(row.resolve_due_at).getTime() < now) return true;
  return false;
}

function NewIncidentForm({ onCreated }: { onCreated: (row: OpsIncidentRow) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<OpsIncidentCategory>("technical");
  const [severity, setSeverity] = useState<OpsIncidentSeverity>("sev3");
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Raise incident</Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Raise a new incident</CardTitle>
        <CardDescription>
          Log it now, even before the full picture is clear — the SLA clock is set from the
          severity you pick and starts immediately. You can add detail, a root cause and
          corrective action as the incident progresses.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="inc-title">Title</Label>
          <Input id="inc-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inc-category">Category</Label>
          <Select
            id="inc-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as OpsIncidentCategory)}
          >
            {(Object.keys(CATEGORY_LABEL) as OpsIncidentCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inc-severity">Severity</Label>
          <Select
            id="inc-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as OpsIncidentSeverity)}
          >
            <option value="sev1">Sev1 — patient safety / platform down / confirmed breach</option>
            <option value="sev2">Sev2 — core journey broken, or money moving wrongly</option>
            <option value="sev3">Sev3 — degraded, workaround in place</option>
            <option value="sev4">Sev4 — cosmetic / low impact</option>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="inc-summary">What&apos;s happening</Label>
          <Textarea id="inc-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button
            disabled={pending || !title.trim()}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const supabase = createClient();
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                const { data, error: insertError } = await supabase
                  .from("ops_incidents")
                  .insert({
                    title: title.trim(),
                    category,
                    severity,
                    summary: summary.trim() || null,
                    reported_by: user?.id ?? null,
                    owner_id: user?.id ?? null,
                    // private.ops_incident_set_sla (BEFORE INSERT) always
                    // overwrites these from severity — placeholders just
                    // satisfy the NOT NULL column type.
                    ack_due_at: new Date().toISOString(),
                    resolve_due_at: new Date().toISOString(),
                  })
                  .select(
                    "id, reference, category, severity, status, title, summary, detected_at, ack_due_at, resolve_due_at, acknowledged_at, resolved_at, closed_at, owner_id, requires_regulatory_notification"
                  )
                  .single();
                if (insertError || !data) {
                  setError(insertError?.message ?? "Could not save");
                  return;
                }
                onCreated(data as OpsIncidentRow);
                setOpen(false);
                setTitle("");
                setSummary("");
              });
            }}
          >
            {pending ? "Saving…" : "Raise incident"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function IncidentsManager({
  initialIncidents,
  canManage,
}: {
  initialIncidents: OpsIncidentRow[];
  canManage: boolean;
}) {
  const [incidents, setIncidents] = useState(initialIncidents);
  const open = incidents.filter((i) => i.status !== "closed");

  return (
    <div className="space-y-6">
      {canManage && <NewIncidentForm onCreated={(row) => setIncidents((prev) => [row, ...prev])} />}
      <Card>
        <CardHeader>
          <CardTitle>Incidents</CardTitle>
          <CardDescription>
            {open.length} open or in progress · {open.filter(isPastSla).length} past their SLA
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {incidents.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No incidents logged. That&apos;s the goal.</p>
          ) : (
            incidents.map((incident) => (
              <Link
                key={incident.id}
                href={`/admin/ops/incidents/${incident.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 p-3 hover:bg-warm-ivory"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-charcoal-ink/50">{incident.reference}</span>
                  <Badge variant={SEVERITY_VARIANT[incident.severity]}>{incident.severity}</Badge>
                  <Badge variant={incident.status === "closed" ? "grey" : "amber"}>
                    {STATUS_LABEL[incident.status]}
                  </Badge>
                  <Badge variant="grey">{CATEGORY_LABEL[incident.category]}</Badge>
                  <span className="font-medium text-charcoal-ink">{incident.title}</span>
                </div>
                {isPastSla(incident) && (
                  <span className="text-xs font-semibold text-red-600">Past SLA</span>
                )}
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
