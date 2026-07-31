"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type DataBreachIncidentRow = {
  id: string;
  title: string;
  discovered_at: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "contained" | "notified" | "closed";
  affected_data_categories: string[];
  estimated_affected_patients: number | null;
  description: string;
  containment_actions: string | null;
  ndpc_notified_at: string | null;
  ndpc_notification_reference: string | null;
  patients_notified_at: string | null;
  follow_up_actions: string | null;
  closed_at: string | null;
};

const SEVERITY_VARIANT: Record<DataBreachIncidentRow["severity"], "green" | "amber" | "red" | "grey"> = {
  low: "grey",
  medium: "amber",
  high: "red",
  critical: "red",
};

const STATUS_LABEL: Record<DataBreachIncidentRow["status"], string> = {
  open: "Open — contain",
  contained: "Contained — notify NDPC",
  notified: "NDPC notified",
  closed: "Closed",
};

function deadlineText(discoveredAt: string, ndpcNotifiedAt: string | null): { text: string; urgent: boolean } {
  if (ndpcNotifiedAt) return { text: "NDPC notified", urgent: false };
  const deadline = new Date(discoveredAt).getTime() + 72 * 60 * 60 * 1000;
  const hoursLeft = (deadline - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft < 0) {
    return { text: `Past the 72-hour NDPC window by ${Math.round(-hoursLeft)}h`, urgent: true };
  }
  return { text: `${Math.round(hoursLeft)}h left to notify NDPC`, urgent: hoursLeft < 24 };
}

function NewIncidentForm({ onCreated }: { onCreated: (row: DataBreachIncidentRow) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [discoveredAt, setDiscoveredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [severity, setSeverity] = useState<DataBreachIncidentRow["severity"]>("medium");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState("");
  const [affectedCount, setAffectedCount] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline">
        New incident
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a new incident</CardTitle>
        <CardDescription>
          Log it now, even before all the facts are confirmed — the 72-hour NDPC clock starts the
          moment TarragonHealth becomes aware, not once the investigation finishes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="incident-title">Title</Label>
          <Input id="incident-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-discovered">Discovered at</Label>
          <Input
            id="incident-discovered"
            type="datetime-local"
            value={discoveredAt}
            onChange={(e) => setDiscoveredAt(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-severity">Severity</Label>
          <Select
            id="incident-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as DataBreachIncidentRow["severity"])}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-categories">Affected data categories (comma-separated)</Label>
          <Input
            id="incident-categories"
            placeholder="clinical notes, payment references"
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-count">Estimated affected patients</Label>
          <Input
            id="incident-count"
            type="number"
            min={0}
            value={affectedCount}
            onChange={(e) => setAffectedCount(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="incident-description">What happened (running log — you can add more later)</Label>
          <Textarea
            id="incident-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button
            disabled={pending || !title.trim() || !description.trim()}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const supabase = createClient();
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                const { data, error: insertError } = await supabase
                  .from("data_breach_incidents")
                  .insert({
                    title: title.trim(),
                    discovered_at: new Date(discoveredAt).toISOString(),
                    severity,
                    description: description.trim(),
                    affected_data_categories: categories
                      .split(",")
                      .map((c) => c.trim())
                      .filter(Boolean),
                    estimated_affected_patients: affectedCount ? Number(affectedCount) : null,
                    reported_by: user?.id ?? null,
                  })
                  .select("*")
                  .single();
                if (insertError || !data) {
                  setError(insertError?.message ?? "Could not save");
                  return;
                }
                onCreated(data as DataBreachIncidentRow);
                setOpen(false);
                setTitle("");
                setDescription("");
                setCategories("");
                setAffectedCount("");
              });
            }}
          >
            {pending ? "Saving…" : "Log incident"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentRow({
  incident,
  onUpdate,
}: {
  incident: DataBreachIncidentRow;
  onUpdate: (row: DataBreachIncidentRow) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [ndpcRef, setNdpcRef] = useState(incident.ndpc_notification_reference ?? "");
  const [error, setError] = useState<string | null>(null);
  const deadline = deadlineText(incident.discovered_at, incident.ndpc_notified_at);

  function patch(fields: Partial<DataBreachIncidentRow>) {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: updateError } = await supabase
        .from("data_breach_incidents")
        .update(fields)
        .eq("id", incident.id)
        .select("*")
        .single();
      if (updateError || !data) {
        setError(updateError?.message ?? "Could not save");
        return;
      }
      onUpdate(data as DataBreachIncidentRow);
    });
  }

  return (
    <div className="rounded-md border border-charcoal-ink/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-charcoal-ink">{incident.title}</span>
          <Badge variant={SEVERITY_VARIANT[incident.severity]}>{incident.severity}</Badge>
          <Badge variant={incident.status === "closed" ? "grey" : "amber"}>
            {STATUS_LABEL[incident.status]}
          </Badge>
        </div>
        <span className={`text-xs font-medium ${deadline.urgent ? "text-red-600" : "text-charcoal-ink/50"}`}>
          {deadline.text}
        </span>
      </div>
      <p className="text-sm text-charcoal-ink/70">{incident.description}</p>
      {incident.affected_data_categories.length > 0 && (
        <p className="text-xs text-charcoal-ink/50">
          Categories: {incident.affected_data_categories.join(", ")}
          {incident.estimated_affected_patients != null &&
            ` · ~${incident.estimated_affected_patients} patients`}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {incident.status !== "closed" && (
        <div className="flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
          {incident.status === "open" && (
            <Button size="sm" disabled={pending} onClick={() => patch({ status: "contained" })}>
              Mark contained
            </Button>
          )}
          {incident.status === "contained" && !incident.ndpc_notified_at && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`ndpc-ref-${incident.id}`} className="text-xs">
                  NDPC notification reference
                </Label>
                <Input
                  id={`ndpc-ref-${incident.id}`}
                  className="h-8 w-56"
                  value={ndpcRef}
                  onChange={(e) => setNdpcRef(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  patch({
                    ndpc_notified_at: new Date().toISOString(),
                    ndpc_notification_reference: ndpcRef.trim() || null,
                    status: "notified",
                  })
                }
              >
                Mark NDPC notified
              </Button>
            </>
          )}
          {incident.status === "notified" && !incident.patients_notified_at && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => patch({ patients_notified_at: new Date().toISOString() })}
            >
              Mark patients notified
            </Button>
          )}
          {incident.status === "notified" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => patch({ status: "closed", closed_at: new Date().toISOString() })}
            >
              Close incident
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function DataBreachIncidentsManager({
  initialIncidents,
}: {
  initialIncidents: DataBreachIncidentRow[];
}) {
  const [incidents, setIncidents] = useState(initialIncidents);

  return (
    <div className="space-y-6">
      <NewIncidentForm onCreated={(row) => setIncidents((prev) => [row, ...prev])} />
      <Card>
        <CardHeader>
          <CardTitle>Incidents</CardTitle>
          <CardDescription>
            {incidents.filter((i) => i.status !== "closed").length} open or in progress.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {incidents.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No incidents logged.</p>
          ) : (
            incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                onUpdate={(row) =>
                  setIncidents((prev) => prev.map((i) => (i.id === row.id ? row : i)))
                }
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
