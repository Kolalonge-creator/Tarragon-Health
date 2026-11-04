"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/form-error";
import { filePathologyReport } from "./pathology-report-actions";

const KIND_LABEL: Record<string, string> = {
  histopathology: "Histopathology",
  cytology: "Cytology",
  cervical_cytology: "Cervical cytology",
  hpv: "HPV test",
};

/** Copy a pathology or cervical result from the report, as printed (clinical document engine step 5b). */
export function PathologyReportForm({ documentId, patientId, pipeline }: { documentId: string; patientId: string; pipeline: "pathology" | "cervical" }) {
  const router = useRouter();
  const id = useId();
  const kinds = pipeline === "cervical" ? ["cervical_cytology", "hpv"] : ["histopathology", "cytology"];
  const [kind, setKind] = useState(kinds[0]!);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = (name: string, label: string, opts: { area?: boolean; type?: string } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${name}`}>{label}</Label>
      {opts.area ? (
        <Textarea id={`${id}-${name}`} name={name} rows={2} />
      ) : (
        <Input id={`${id}-${name}`} name={name} type={opts.type ?? "text"} />
      )}
    </div>
  );

  return (
    <form
      className="mt-2 space-y-3 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15"
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget).entries());
        setError(null);
        start(async () => {
          const res = await filePathologyReport({ ...data, documentId, patientId, report_kind: kind });
          if (!res.ok) setError(res.error);
          else router.refresh();
        });
      }}
    >
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Copy each line exactly as printed. Leave out anything that is not on the report.</p>
      <div className="space-y-1">
        <Label htmlFor={`${id}-kind`}>Result type</Label>
        <Select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)} className="min-h-11">
          {kinds.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </Select>
      </div>
      {(kind === "histopathology" || kind === "cytology") && (
        <>
          {field("specimen", "Specimen")}
          {field("site", "Site")}
          {field("diagnosis_as_printed", "Diagnosis line, as printed", { area: true })}
          {field("grade_as_printed", "Grade (only if printed)")}
          {field("stage_as_printed", "Stage (only if printed)")}
        </>
      )}
      {kind === "cervical_cytology" && field("cytology_category_as_printed", "Cytology category, as printed (for example NILM, LSIL, HSIL)")}
      {kind === "hpv" && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-hpv`}>HPV result, as printed</Label>
          <Select id={`${id}-hpv`} name="hpv_result_as_printed" className="min-h-11" defaultValue="">
            <option value="">Choose</option>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
            <option value="invalid">Invalid or inadequate</option>
          </Select>
        </div>
      )}
      {(kind === "hpv" || kind === "cervical_cytology") && field("hpv_genotypes_as_printed", "HPV genotypes, as printed (if any)")}
      {field("recommendation_as_printed", "Recommendation, as printed", { area: true })}
      {field("pathologist_name", "Pathologist")}
      {field("laboratory_name", "Laboratory")}
      {field("reported_on", "Report date", { type: "date" })}
      <div className="space-y-1">
        <Label htmlFor={`${id}-note`}>Your review</Label>
        <Textarea id={`${id}-note`} name="note" rows={2} placeholder="What you found and what happens next" />
      </div>
      <Button type="submit" className="min-h-11" disabled={pending}>
        {pending ? "Filing" : "File the result"}
      </Button>
      {error && <FormError id={`${id}-error`} message={error} />}
    </form>
  );
}
