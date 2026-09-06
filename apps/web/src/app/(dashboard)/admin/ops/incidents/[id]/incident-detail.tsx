"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { TablesUpdate } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  OpsIncidentCategory,
  OpsIncidentSeverity,
  OpsIncidentStatus,
} from "../incidents-manager";

export type OpsIncidentDetailRow = {
  id: string;
  reference: string;
  organisation_id: string | null;
  category: OpsIncidentCategory;
  severity: OpsIncidentSeverity;
  status: OpsIncidentStatus;
  title: string;
  summary: string | null;
  detected_at: string;
  acknowledged_at: string | null;
  mitigated_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  ack_due_at: string;
  resolve_due_at: string;
  impact: string | null;
  patients_affected: number | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  clinical_incident_report_id: string | null;
  data_breach_incident_id: string | null;
  clinician_alert_id: string | null;
  external_reference: string | null;
  requires_regulatory_notification: boolean;
  regulatory_body: string | null;
  regulatory_notified_at: string | null;
};

export type OpsIncidentUpdateRow = {
  id: string;
  note: string;
  status_from: OpsIncidentStatus | null;
  status_to: OpsIncidentStatus | null;
  created_at: string;
  author_id: string | null;
};

const SEVERITY_VARIANT: Record<OpsIncidentSeverity, "red" | "amber" | "blue" | "grey"> = {
  sev1: "red",
  sev2: "amber",
  sev3: "blue",
  sev4: "grey",
};

const STATUS_ORDER: OpsIncidentStatus[] = [
  "open",
  "investigating",
  "mitigated",
  "resolved",
  "closed",
];

const STATUS_LABEL: Record<OpsIncidentStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  mitigated: "Mitigated",
  resolved: "Resolved",
  closed: "Closed",
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export function IncidentDetail({
  incident: initial,
  updates: initialUpdates,
  canManage,
}: {
  incident: OpsIncidentDetailRow;
  updates: OpsIncidentUpdateRow[];
  canManage: boolean;
}) {
  const [incident, setIncident] = useState(initial);
  const [updates, setUpdates] = useState(initialUpdates);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [rootCause, setRootCause] = useState(incident.root_cause ?? "");
  const [corrective, setCorrective] = useState(incident.corrective_action ?? "");
  const [preventive, setPreventive] = useState(incident.preventive_action ?? "");
  const [note, setNote] = useState("");
  const [regBody, setRegBody] = useState(incident.regulatory_body ?? "");

  const nextStatus = STATUS_ORDER[STATUS_ORDER.indexOf(incident.status) + 1];
  const isPastAckSla = !incident.acknowledged_at && new Date(incident.ack_due_at) < new Date();
  const isPastResolveSla =
    !incident.resolved_at &&
    incident.status !== "closed" &&
    new Date(incident.resolve_due_at) < new Date();

  async function refreshUpdates() {
    const supabase = createClient();
    const { data } = await supabase
      .from("ops_incident_updates")
      .select("id, note, status_from, status_to, created_at, author_id")
      .eq("incident_id", incident.id)
      .order("created_at", { ascending: false });
    setUpdates((data ?? []) as OpsIncidentUpdateRow[]);
  }

  function advanceStatus() {
    if (!nextStatus) return;
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const patch: TablesUpdate<"ops_incidents"> = { status: nextStatus };
      // resolved/closed require root_cause on file — save it in the same
      // write so the DB check constraint never rejects the transition.
      if (nextStatus === "resolved" || nextStatus === "closed") {
        if (!rootCause.trim()) {
          setError("A root cause is required to resolve or close an incident.");
          return;
        }
        patch.root_cause = rootCause.trim();
        patch.corrective_action = corrective.trim() || null;
        patch.preventive_action = preventive.trim() || null;
      }
      const { data, error: updateError } = await supabase
        .from("ops_incidents")
        .update(patch)
        .eq("id", incident.id)
        .select("*")
        .single();
      if (updateError || !data) {
        setError(updateError?.message ?? "Could not update the incident");
        return;
      }
      setIncident(data as OpsIncidentDetailRow);
      await refreshUpdates();
    });
  }

  function saveNarrative() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: updateError } = await supabase
        .from("ops_incidents")
        .update({
          root_cause: rootCause.trim() || null,
          corrective_action: corrective.trim() || null,
          preventive_action: preventive.trim() || null,
        })
        .eq("id", incident.id)
        .select("*")
        .single();
      if (updateError || !data) {
        setError(updateError?.message ?? "Could not save");
        return;
      }
      setIncident(data as OpsIncidentDetailRow);
    });
  }

  function postNote() {
    if (!note.trim()) return;
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from("ops_incident_updates").insert({
        incident_id: incident.id,
        author_id: user?.id ?? null,
        note: note.trim(),
        status_from: incident.status,
        status_to: incident.status,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
      setNote("");
      await refreshUpdates();
    });
  }

  function saveRegulatory(requires: boolean) {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const patch: TablesUpdate<"ops_incidents"> = { requires_regulatory_notification: requires };
      if (requires) {
        if (!regBody.trim()) {
          setError("Name the regulatory body before marking this as reportable.");
          return;
        }
        patch.regulatory_body = regBody.trim();
      }
      const { data, error: updateError } = await supabase
        .from("ops_incidents")
        .update(patch)
        .eq("id", incident.id)
        .select("*")
        .single();
      if (updateError || !data) {
        setError(updateError?.message ?? "Could not save");
        return;
      }
      setIncident(data as OpsIncidentDetailRow);
    });
  }

  function markRegulatorNotified() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: updateError } = await supabase
        .from("ops_incidents")
        .update({ regulatory_notified_at: new Date().toISOString() })
        .eq("id", incident.id)
        .select("*")
        .single();
      if (updateError || !data) {
        setError(updateError?.message ?? "Could not save");
        return;
      }
      setIncident(data as OpsIncidentDetailRow);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/ops/incidents" className="text-sm text-charcoal-ink/60 hover:underline">
          ← Incident register
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-charcoal-ink/50">{incident.reference}</span>
          <Badge variant={SEVERITY_VARIANT[incident.severity]}>{incident.severity}</Badge>
          <Badge variant={incident.status === "closed" ? "grey" : "amber"}>
            {STATUS_LABEL[incident.status]}
          </Badge>
          <Badge variant="grey">{incident.category}</Badge>
          {(isPastAckSla || isPastResolveSla) && (
            <Badge variant="red">Past SLA</Badge>
          )}
        </div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{incident.title}</h1>
        {incident.summary && <p className="text-charcoal-ink/70">{incident.summary}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>Append-only: nothing here can be edited or deleted.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {canManage && (
                <div className="flex gap-2 border-b border-charcoal-ink/10 pb-3">
                  <Input
                    placeholder="Add an update…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button size="sm" disabled={pending || !note.trim()} onClick={postNote}>
                    Post
                  </Button>
                </div>
              )}
              {updates.length === 0 ? (
                <p className="text-sm text-charcoal-ink/50">No updates yet.</p>
              ) : (
                updates.map((u) => (
                  <div key={u.id} className="border-b border-charcoal-ink/5 pb-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-charcoal-ink/80">{u.note}</span>
                      <span className="whitespace-nowrap text-xs text-charcoal-ink/40">
                        {fmt(u.created_at)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Root cause &amp; corrective action</CardTitle>
              <CardDescription>
                Required before this incident can be resolved or closed. This is the record that
                the platform actually learns something from an incident, not just that it happened.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="root-cause">Root cause</Label>
                <Textarea id="root-cause" rows={3} value={rootCause} onChange={(e) => setRootCause(e.target.value)} disabled={!canManage} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="corrective">Corrective action (what fixed it)</Label>
                <Textarea id="corrective" rows={2} value={corrective} onChange={(e) => setCorrective(e.target.value)} disabled={!canManage} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="preventive">Preventive action (what stops it recurring)</Label>
                <Textarea id="preventive" rows={2} value={preventive} onChange={(e) => setPreventive(e.target.value)} disabled={!canManage} />
              </div>
              {canManage && (
                <Button size="sm" variant="outline" disabled={pending} onClick={saveNarrative}>
                  Save
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {canManage && incident.status !== "closed" && (
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {error && <p className="text-sm text-red-600">{error}</p>}
                {nextStatus && (
                  <Button className="w-full" disabled={pending} onClick={advanceStatus}>
                    Mark {STATUS_LABEL[nextStatus].toLowerCase()}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>SLA</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-charcoal-ink/60">Detected</span>
                <span>{fmt(incident.detected_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-charcoal-ink/60">Ack due</span>
                <span className={isPastAckSla ? "font-semibold text-red-600" : ""}>
                  {fmt(incident.ack_due_at)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-charcoal-ink/60">Acknowledged</span>
                <span>{fmt(incident.acknowledged_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-charcoal-ink/60">Resolve due</span>
                <span className={isPastResolveSla ? "font-semibold text-red-600" : ""}>
                  {fmt(incident.resolve_due_at)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-charcoal-ink/60">Resolved</span>
                <span>{fmt(incident.resolved_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-charcoal-ink/60">Closed</span>
                <span>{fmt(incident.closed_at)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Regulatory notification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {incident.requires_regulatory_notification ? (
                <>
                  <p className="text-charcoal-ink/70">
                    Reportable to <span className="font-medium">{incident.regulatory_body}</span>.
                  </p>
                  {incident.regulatory_notified_at ? (
                    <p className="text-charcoal-ink/60">
                      Notified {fmt(incident.regulatory_notified_at)}
                    </p>
                  ) : (
                    canManage && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={markRegulatorNotified}>
                        Mark notified
                      </Button>
                    )
                  )}
                </>
              ) : (
                canManage && (
                  <div className="space-y-2">
                    <Input
                      placeholder="Regulatory body (e.g. NDPC)"
                      value={regBody}
                      onChange={(e) => setRegBody(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => saveRegulatory(true)}
                    >
                      Mark reportable
                    </Button>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
