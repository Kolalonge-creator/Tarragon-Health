"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { saveBloodProfileFromReport } from "./blood-profile-actions";
import { PATIENT_ATTESTED_CAVEAT } from "@/lib/clinical/blood-attestation";

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;
const GENOTYPES = ["AA", "AS", "AC", "SS", "SC", "CC", "other"] as const;

export interface BloodProfileInitial {
  bloodGroup: string | null;
  genotype: string | null;
  genotypeNote: string | null;
  provenance: string | null;
  documentId: string | null;
  attestedAt: string | null;
  recordedAt: string | null;
}

export interface ReportOption {
  id: string;
  label: string;
}

/**
 * A clinician records blood group and genotype FROM AN UPLOADED REPORT.
 *
 * There is no unsourced path. The database refuses a lab-backed value with no
 * linked report and refuses a report belonging to a different patient, so the
 * report picker is the evidence, not a convenience field. If the patient has
 * uploaded nothing, this form says so rather than offering a box to type a
 * genotype into on trust.
 *
 * A value the PATIENT attested is shown here read-only with its caveat, so a
 * clinician can see it, act on it with the right level of confidence, and
 * replace it the moment a real report arrives.
 */
export function BloodProfileForm({
  patientId,
  initial,
  reports,
}: {
  patientId: string;
  initial: BloodProfileInitial | null;
  reports: ReportOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bloodGroup, setBloodGroup] = useState(initial?.bloodGroup ?? "");
  const [genotype, setGenotype] = useState(initial?.genotype ?? "");
  const [note, setNote] = useState(initial?.genotypeNote ?? "");
  const [documentId, setDocumentId] = useState(initial?.documentId ?? "");

  const patientAttested = initial?.provenance === "patient_attested";

  function submit() {
    setError(null);
    setMessage(null);
    if (!bloodGroup && !genotype) {
      setError("Record at least a blood group or a genotype.");
      return;
    }
    if (!documentId) {
      setError("Choose the lab report this came from.");
      return;
    }
    startTransition(async () => {
      const result = await saveBloodProfileFromReport({
        patient_id: patientId,
        blood_group: bloodGroup || null,
        genotype: genotype || null,
        genotype_note: genotype === "other" ? note || null : null,
        document_id: documentId,
      });
      if (result.error) setError(result.error);
      if (result.message) setMessage(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blood group and genotype</CardTitle>
        <CardDescription>
          Two facts that change what a receiving team does immediately, and the first thing on this
          patient&rsquo;s emergency card. Record them only from an uploaded lab report.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {initial ? (
          <div className="rounded-lg border border-charcoal-ink/15 bg-charcoal-ink/[0.02] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-charcoal-ink">
                {initial.bloodGroup ?? "Group not recorded"}
                {initial.genotype ? ` · Genotype ${initial.genotype}` : ""}
              </span>
              <Badge variant={patientAttested ? "amber" : "green"}>
                {patientAttested ? "Patient-reported" : "From a lab report"}
              </Badge>
            </div>
            {patientAttested ? (
              <p className="mt-1 text-xs text-amber-700">
                {PATIENT_ATTESTED_CAVEAT} Replace it below once a report is on file.
              </p>
            ) : null}
          </div>
        ) : null}

        {reports.length === 0 ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            No lab report has been uploaded for this patient, so there is nothing to record a blood
            group or genotype against. Ask them to upload the result first.
          </p>
        ) : (
          <>
            <label className="block text-sm">
              <span className="block text-xs text-charcoal-ink/60">
                Which uploaded report did this come from?
              </span>
              <select
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                className="mt-1 w-full rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
              >
                <option value="">Choose a report…</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-3">
              <label className="text-sm">
                <span className="block text-xs text-charcoal-ink/60">Blood group</span>
                <select
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value)}
                  className="mt-1 rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
                >
                  <option value="">Not recorded</option>
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="block text-xs text-charcoal-ink/60">Genotype</span>
                <select
                  value={genotype}
                  onChange={(e) => setGenotype(e.target.value)}
                  className="mt-1 rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
                >
                  <option value="">Not recorded</option>
                  {GENOTYPES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {genotype === "other" ? (
              <label className="block text-sm">
                <span className="block text-xs text-charcoal-ink/60">
                  Which variant? (shown on the emergency card)
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
                  placeholder="e.g. HbS/beta-thalassaemia"
                />
              </label>
            ) : null}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {message ? <p className="text-sm text-brand-green">{message}</p> : null}

            <Button type="button" size="sm" disabled={pending} onClick={submit}>
              {pending ? "Saving…" : "Save from this report"}
            </Button>
          </>
        )}

        {initial?.recordedAt ? (
          <p className="text-xs text-charcoal-ink/55">
            Last recorded{" "}
            {new Date(initial.recordedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
