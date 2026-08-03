"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { saveBloodProfile } from "./blood-profile-actions";

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;
const GENOTYPES = ["AA", "AS", "AC", "SS", "SC", "CC", "other"] as const;

const SOURCES = [
  { value: "lab_result", label: "From a lab result" },
  { value: "clinician_recorded", label: "Recorded by a clinician" },
  { value: "patient_reported", label: "As the patient reports it" },
] as const;

/**
 * Records blood group and haemoglobin genotype as structured facts.
 *
 * Until now the platform sold the blood group and genotype test and had nowhere
 * to keep the answer — it survived only as prose in a result summary, so
 * nothing could read it back. These two facts carry disproportionate weight in
 * a Nigerian emergency, and they are what the emergency card leads with.
 *
 * `source` is required rather than defaulted silently: a lab report and a
 * patient's recollection are both worth having and are not the same claim, and
 * the emergency card says which one it is showing.
 */
export function BloodProfileForm({
  patientId,
  initial,
}: {
  patientId: string;
  initial: {
    bloodGroup: string | null;
    genotype: string | null;
    genotypeNote: string | null;
    source: string | null;
    recordedAt: string | null;
  } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bloodGroup, setBloodGroup] = useState(initial?.bloodGroup ?? "");
  const [genotype, setGenotype] = useState(initial?.genotype ?? "");
  const [note, setNote] = useState(initial?.genotypeNote ?? "");
  const [source, setSource] = useState(initial?.source ?? "lab_result");

  function submit() {
    setError(null);
    setMessage(null);
    if (!bloodGroup && !genotype) {
      setError("Record at least a blood group or a genotype.");
      return;
    }
    startTransition(async () => {
      const result = await saveBloodProfile({
        patient_id: patientId,
        blood_group: bloodGroup || null,
        genotype: genotype || null,
        genotype_note: note || null,
        source,
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
          Two facts that change what a receiving team does immediately. These lead the patient&rsquo;s
          emergency card.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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

          <label className="text-sm">
            <span className="block text-xs text-charcoal-ink/60">Where this came from</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="mt-1 rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-brand-green">{message}</p> : null}

        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
