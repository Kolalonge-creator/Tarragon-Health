"use client";

import { useState } from "react";
import {
  useOpenAffordabilityReports,
  useOpenDispenseFlags,
  useResolveAffordabilityReport,
  useResolveDispenseFlag,
  type AffordabilityReportWithDetails,
  type DispenseFlagWithDetails,
} from "@/lib/queries/medication-issues";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const FLAG_TYPE_LABEL: Record<string, string> = {
  prescription_issue: "Prescription issue",
  availability_issue: "Availability issue",
  interaction_concern: "Interaction concern",
  duplication: "Duplication",
  unclear_instruction: "Unclear instruction",
  patient_query: "Patient question",
  other: "Other",
};

const AFFORDABILITY_ACTIONS = [
  { value: "lower_cost_alternative", label: "Discussed a lower-cost alternative" },
  { value: "alternative_pharmacy", label: "Pointed to an alternative pharmacy" },
  { value: "assistance_programme", label: "Referred to an assistance programme" },
  { value: "care_coordinator_intervention", label: "Care coordinator intervention" },
  { value: "other", label: "Other" },
];

export function MedicationIssuesWorklist({ canResolveConcerns }: { canResolveConcerns: boolean }) {
  const { data: reports, isLoading: reportsLoading, isError: reportsError } =
    useOpenAffordabilityReports();
  const { data: flags, isLoading: flagsLoading, isError: flagsError } = useOpenDispenseFlags();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Affordability reports</CardTitle>
          <CardDescription>
            Patients who told us they could not obtain their medication because of cost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reportsLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {reportsError && (
            <p className="text-sm text-red-600">Could not load affordability reports.</p>
          )}
          {reports && reports.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No open reports.</p>
          )}
          {reports && reports.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {reports.map((report) => (
                <AffordabilityReportRow key={report.id} report={report} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Medication concerns</CardTitle>
          <CardDescription>
            Prescription, interaction, duplication, or other concerns raised about a medication —
            by a patient, a pharmacist, or a colleague.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flagsLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {flagsError && <p className="text-sm text-red-600">Could not load medication concerns.</p>}
          {flags && flags.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No open concerns.</p>
          )}
          {flags && flags.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {flags.map((flag) => (
                <DispenseFlagRow key={flag.id} flag={flag} canResolve={canResolveConcerns} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AffordabilityReportRow({ report }: { report: AffordabilityReportWithDetails }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(AFFORDABILITY_ACTIONS[0]!.value);
  const [note, setNote] = useState("");
  const resolve = useResolveAffordabilityReport();

  return (
    <li className="space-y-1 py-3">
      <div className="flex items-center gap-2">
        <Badge variant={report.status === "in_progress" ? "amber" : "grey"}>
          {report.status === "in_progress" ? "In progress" : "Open"}
        </Badge>
        <p className="text-sm font-medium text-charcoal-ink">
          {report.patient?.full_name ?? "Unknown patient"}
          {report.medication?.drug_name ? ` — ${report.medication.drug_name}` : ""}
        </p>
      </div>
      {report.note && <p className="text-xs text-charcoal-ink/60">&ldquo;{report.note}&rdquo;</p>}
      <p className="text-xs text-charcoal-ink/40">
        Reported {new Date(report.reported_at).toLocaleDateString()}
      </p>
      {!open ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          Resolve
        </Button>
      ) : (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-2">
          <Select
            className="h-8 w-56 text-xs"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            {AFFORDABILITY_ACTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Textarea
            className="min-h-8 w-full text-xs"
            placeholder="What happened?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={!note.trim() || resolve.isPending}
            onClick={() =>
              resolve.mutate(
                { reportId: report.id, resolutionAction: action, resolutionNote: note.trim() },
                { onSuccess: () => setOpen(false) }
              )
            }
          >
            {resolve.isPending ? "Saving…" : "Confirm resolved"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {resolve.isError && (
            <p className="basis-full text-xs text-red-600">Could not resolve that report.</p>
          )}
        </div>
      )}
    </li>
  );
}

function DispenseFlagRow({
  flag,
  canResolve,
}: {
  flag: DispenseFlagWithDetails;
  canResolve: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const resolve = useResolveDispenseFlag();

  return (
    <li className="space-y-1 py-3">
      <div className="flex items-center gap-2">
        <Badge variant="blue">{FLAG_TYPE_LABEL[flag.flag_type] ?? flag.flag_type}</Badge>
        <Badge variant={flag.status === "reviewed" ? "amber" : "grey"}>
          {flag.status === "reviewed" ? "Reviewed" : "Open"}
        </Badge>
        <p className="text-sm font-medium text-charcoal-ink">
          {flag.patient?.full_name ?? "Unknown patient"}
          {flag.medication?.drug_name ? ` — ${flag.medication.drug_name}` : ""}
        </p>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        &ldquo;{flag.note}&rdquo; <span className="text-charcoal-ink/40">· raised by {flag.raised_by_role ?? "unknown"}</span>
      </p>
      {!canResolve ? (
        <span className="text-xs text-charcoal-ink/40">Only a doctor can resolve this</span>
      ) : !open ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          Resolve
        </Button>
      ) : (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-2">
          <Textarea
            className="min-h-8 w-full text-xs"
            placeholder="How was this resolved?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={!note.trim() || resolve.isPending}
            onClick={() =>
              resolve.mutate(
                { flagId: flag.id, resolutionNote: note.trim() },
                { onSuccess: () => setOpen(false) }
              )
            }
          >
            {resolve.isPending ? "Saving…" : "Confirm resolved"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {resolve.isError && (
            <p className="basis-full text-xs text-red-600">Could not resolve that concern.</p>
          )}
        </div>
      )}
    </li>
  );
}
