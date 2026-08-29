import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { LEVEL_BADGE } from "@/lib/worklist/level-badge";
import { MatchResultToOrder, type CandidateOrder } from "./match-result-to-order";
import type { Database, EscalationLevel } from "@tarragon/shared";

type AckStatus = Database["public"]["Enums"]["result_document_acknowledgement_status"];

const ACK_STATUS_BADGE: Record<AckStatus, { label: string; variant: BadgeProps["variant"] }> = {
  new: { label: "New", variant: "grey" },
  opened: { label: "Opened", variant: "blue" },
  reviewed: { label: "Reviewed", variant: "green" },
  action_required: { label: "Action required", variant: "amber" },
  action_completed: { label: "Action completed", variant: "green" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type InboxRow = {
  id: string;
  patient_id: string;
  original_filename: string | null;
  note: string | null;
  created_at: string;
  acknowledgement_status: AckStatus;
  next_steps: string | null;
  patient_interpretation: string | null;
  supersedes_document_id: string | null;
  superseded_by_document_id: string | null;
  patient: { full_name: string | null } | null;
  clinician_alert: { level: EscalationLevel } | null;
};

type UnmatchedRow = {
  id: string;
  patient_id: string;
  original_filename: string | null;
  note: string | null;
  created_at: string;
  source: Database["public"]["Enums"]["lab_result_document_source"];
  patient: { full_name: string | null } | null;
};

type OpenOrderRow = {
  id: string;
  patient_id: string;
  ordered_at: string;
  panel_bundle: { name: string } | null;
};

/**
 * Care Team / Provider Workspace §5.6 — one place every result needing
 * clinical action shows up, instead of scattered per-patient result-document
 * sections. Scoped to lab_result_documents specifically (not
 * screening_results too): a lab_result_document already carries a genuine
 * per-row acknowledgement workflow (§5.7, this same session) and an optional
 * linked clinician_alert for severity; screening_results has no equivalent
 * per-row review state of its own and is reviewed as part of each condition
 * pathway rather than as a standalone document, so folding it into the same
 * list would mean inventing a review state for it that doesn't exist
 * anywhere else in the app.
 *
 * "Protocol interpretation" (the spec's column name) is shown as the
 * doctor's own recorded interpretation once reviewed — there's no
 * rule-engine-generated interpretation for arbitrary uploaded documents
 * (unlike vitals/screening, these are free text, often PDFs); showing
 * anything else here would be fabricated, not "protocol-derived."
 * "Previous" shows the patient's next-most-recent document, if any — not a
 * numeric trend, since most uploads carry no structured values to trend.
 */
export default async function ResultsInboxPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("lab_result_documents")
    .select(
      "id, patient_id, original_filename, note, created_at, acknowledgement_status, next_steps, patient_interpretation, supersedes_document_id, superseded_by_document_id, patient:profiles!lab_result_documents_patient_id_fkey(full_name), clinician_alert:clinician_alerts!lab_result_documents_clinician_alert_id_fkey(level)",
    )
    .neq("acknowledgement_status", "action_completed")
    .order("created_at", { ascending: true })
    .limit(200)
    .returns<InboxRow[]>();

  const rows = data ?? [];

  // Previous document per patient — the row immediately before each in the
  // patient's own timeline, from the same fetch (cheap: this page is
  // already capped at 200 rows org-wide).
  const byPatient = new Map<string, InboxRow[]>();
  for (const row of rows) {
    const list = byPatient.get(row.patient_id) ?? [];
    list.push(row);
    byPatient.set(row.patient_id, list);
  }

  // Module 57.12/57.13 — documents that arrived with no lab_order link yet.
  // "Do not automatically attach it; send to a reconciliation queue" (57.13):
  // this section IS that queue — lab_order_id stays null until a clinician
  // picks the right order below, never guessed automatically.
  const { data: unmatchedData } = await supabase
    .from("lab_result_documents")
    .select(
      "id, patient_id, original_filename, note, created_at, source, patient:profiles!lab_result_documents_patient_id_fkey(full_name)",
    )
    .is("lab_order_id", null)
    .order("created_at", { ascending: true })
    .limit(100)
    .returns<UnmatchedRow[]>();

  const unmatchedRows = unmatchedData ?? [];
  const unmatchedPatientIds = [...new Set(unmatchedRows.map((r) => r.patient_id))];

  const { data: openOrdersData } =
    unmatchedPatientIds.length === 0
      ? { data: [] as OpenOrderRow[] }
      : await supabase
          .from("lab_orders")
          .select("id, patient_id, ordered_at, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name)")
          .in("patient_id", unmatchedPatientIds)
          .neq("status", "resulted")
          .neq("status", "cancelled")
          .order("ordered_at", { ascending: false })
          .returns<OpenOrderRow[]>();

  const openOrdersByPatient = new Map<string, CandidateOrder[]>();
  for (const order of openOrdersData ?? []) {
    const list = openOrdersByPatient.get(order.patient_id) ?? [];
    list.push({
      id: order.id,
      label: `${order.panel_bundle?.name ?? "Lab test"} · ordered ${formatDate(order.ordered_at)}`,
    });
    openOrdersByPatient.set(order.patient_id, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Results inbox</h1>
        <p className="text-sm text-charcoal-ink/60">
          Every result document not yet fully actioned, oldest first. New and unreviewed items are
          uploads a signed URL has never been generated for; Opened means someone has looked but not
          yet recorded a finding.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting action ({rows.length})</CardTitle>
          <CardDescription>Across every patient in your organisation.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting — the inbox is clear.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                    <th className="py-2 pr-3 font-medium">Patient</th>
                    <th className="py-2 pr-3 font-medium">Test</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Severity</th>
                    <th className="py-2 pr-3 font-medium">Previous</th>
                    <th className="py-2 pr-3 font-medium">Interpretation</th>
                    <th className="py-2 font-medium">Required action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-ink/10">
                  {rows.map((row) => {
                    const siblings = byPatient.get(row.patient_id) ?? [];
                    const idx = siblings.findIndex((r) => r.id === row.id);
                    const previous = idx > 0 ? siblings[idx - 1] : undefined;
                    const status = ACK_STATUS_BADGE[row.acknowledgement_status];
                    const severity = row.clinician_alert ? LEVEL_BADGE[row.clinician_alert.level] : null;
                    return (
                      <tr key={row.id}>
                        <td className="py-2.5 pr-3">
                          <Link
                            href={`/clinician/patients/${row.patient_id}`}
                            className="font-medium text-brand-green hover:underline"
                          >
                            {row.patient?.full_name ?? "Unnamed patient"}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 text-charcoal-ink/80">
                          {row.original_filename ?? row.note ?? "Result document"}
                          {/* Module 57.14: the original stays traceable, never hidden — just
                              labelled once it has been corrected or is itself a correction. */}
                          {row.superseded_by_document_id && (
                            <Badge variant="amber" className="ml-1.5">
                              Amended
                            </Badge>
                          )}
                          {row.supersedes_document_id && (
                            <Badge variant="blue" className="ml-1.5">
                              Correction
                            </Badge>
                          )}
                          <div className="text-xs text-charcoal-ink/50">{formatDate(row.created_at)}</div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="py-2.5 pr-3">
                          {severity ? (
                            <Badge variant={severity.variant}>{severity.label}</Badge>
                          ) : (
                            <span className="text-xs text-charcoal-ink/40">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-charcoal-ink/60">
                          {previous ? formatDate(previous.created_at) : "None on file"}
                        </td>
                        <td className="py-2.5 pr-3 max-w-xs truncate text-charcoal-ink/70">
                          {row.patient_interpretation ?? "Not yet reviewed"}
                        </td>
                        <td className="py-2.5 text-charcoal-ink/70">
                          {row.next_steps ?? (row.acknowledgement_status === "reviewed" ? "None flagged" : "Awaiting review")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Needs order matching ({unmatchedRows.length})</CardTitle>
          <CardDescription>
            Result documents with no lab order on file — an emailed or uploaded result that arrived
            without (or ahead of) its request. Per module 57.13, nothing here is auto-attached; pick
            the right order below, or leave it if none exists yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unmatchedRows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Every result document is linked to an order.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {unmatchedRows.map((row) => (
                <li key={row.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/clinician/patients/${row.patient_id}`}
                      className="font-medium text-brand-green hover:underline"
                    >
                      {row.patient?.full_name ?? "Unnamed patient"}
                    </Link>
                    <span className="text-xs text-charcoal-ink/50">{formatDate(row.created_at)}</span>
                  </div>
                  <p className="text-sm text-charcoal-ink/80">
                    {row.original_filename ?? row.note ?? `${row.source} upload`}
                  </p>
                  <MatchResultToOrder
                    documentId={row.id}
                    candidates={openOrdersByPatient.get(row.patient_id) ?? []}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
