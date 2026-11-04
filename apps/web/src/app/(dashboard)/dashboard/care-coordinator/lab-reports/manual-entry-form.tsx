"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilePicker } from "@/components/ui/file-picker";
import { enterResultsByHand, type UploadState } from "./actions";

export type TestOption = { code: string; label: string; units: string[]; values: string[] | null };
type LabOption = { id: string; name: string; assigned: boolean };

type Row = {
  key: number;
  code: string;
  label: string;
  value: string;
  unit: string;
  labRange: string;
  labFlag: string;
  specimen: string;
  comment: string;
};

const OTHER = "other";
const OTHER_LAB = "__other__";
const FLAGS = [
  ["none", "No flag"],
  ["normal", "Normal"],
  ["high", "High"],
  ["low", "Low"],
  ["abnormal", "Abnormal"],
  ["critical", "Critical"],
] as const;

const SELECT = "h-9 w-full rounded-md border border-charcoal-ink/20 bg-transparent px-2 text-sm";

let nextKey = 1;
function emptyRow(): Row {
  return { key: nextKey++, code: "", label: "", value: "", unit: "", labRange: "", labFlag: "none", specimen: "", comment: "" };
}

/**
 * CDE-02: type in results a laboratory sent as values (an email, a printed sheet). Several tests in one go. What is typed becomes a
 * draft a doctor checks against the source and files; it is labelled "typed in by hand" everywhere and is never treated as checked.
 */
export function ManualEntryForm({
  patientId,
  labs,
  tests,
}: {
  patientId: string;
  labs: LabOption[];
  tests: TestOption[];
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [lab, setLab] = useState("");
  const [state, formAction, pending] = useActionState<UploadState, FormData>(enterResultsByHand, undefined);
  const byCode = new Map(tests.map((t) => [t.code, t]));

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const payload = JSON.stringify(
    rows.map((r) => {
      const t = byCode.get(r.code);
      const qualitative = Boolean(t?.values);
      // "6,8" is how some laboratories print 6.8.
      const numeric = r.value.trim() === "" ? null : Number(r.value.trim().replace(",", "."));
      return {
        code: r.code,
        ...(r.code === OTHER ? { label: r.label } : {}),
        ...(qualitative || (r.code === OTHER && (numeric === null || Number.isNaN(numeric)))
          ? { valueText: r.value.trim() || null, value: null }
          : { value: numeric === null || Number.isNaN(numeric) ? null : numeric, valueText: null }),
        unit: r.unit.trim() || null,
        labRange: r.labRange.trim() || null,
        labFlag: r.labFlag,
        specimen: r.specimen.trim() || null,
        comment: r.comment.trim() || null,
      };
    }),
  );

  return (
    <form action={formAction} className="space-y-4" key={patientId}>
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="rows" value={payload} />
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Type the results exactly as the laboratory sent them. A doctor checks each value against the source before anything is added
        to the patient&apos;s record. A critical value goes to the doctor straight away.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="m-name">Patient name in the source</Label>
          <Input id="m-name" name="nameOnReport" required minLength={3} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-dob">Date of birth in the source</Label>
          <Input id="m-dob" name="dateOfBirthOnReport" type="date" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-number">Patient number in the source</Label>
          <Input id="m-number" name="patientNumberOnReport" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="m-lab">Laboratory</Label>
          <select
            id="m-lab"
            name={lab === OTHER_LAB ? undefined : "labProviderId"}
            value={lab}
            onChange={(e) => setLab(e.target.value)}
            required
            className={SELECT}
          >
            <option value="" disabled>
              Choose
            </option>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.assigned ? " (yours)" : ""}
              </option>
            ))}
            <option value={OTHER_LAB}>Another laboratory</option>
          </select>
        </div>
        {lab === OTHER_LAB ? (
          <div className="space-y-1">
            <Label htmlFor="m-labname">Laboratory name</Label>
            <Input id="m-labname" name="labName" required maxLength={200} />
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="m-date">Test date</Label>
          <Input id="m-date" name="reportDate" type="date" required />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="m-source">Where did the values come from?</Label>
        <Input id="m-source" name="sourceDescription" required minLength={3} maxLength={300} placeholder="For example: email from Synlab Ikeja, 3 Nov" />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Results</legend>
        {rows.map((r, i) => {
          const t = byCode.get(r.code);
          return (
            <div key={r.key} className="grid gap-2 rounded-md border border-charcoal-ink/10 p-3 sm:grid-cols-6">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`m-test-${r.key}`}>Test {i + 1}</Label>
                <select
                  id={`m-test-${r.key}`}
                  value={r.code}
                  onChange={(e) => {
                    const next = byCode.get(e.target.value);
                    update(r.key, { code: e.target.value, unit: next?.units[0] ?? "", value: "" });
                  }}
                  required
                  className={SELECT}
                >
                  <option value="" disabled>
                    Choose a test
                  </option>
                  {tests.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                  <option value={OTHER}>A test not in this list</option>
                </select>
                {r.code === OTHER ? (
                  <Input aria-label={`Name of test ${i + 1}`} placeholder="Test name" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} />
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`m-value-${r.key}`}>Result</Label>
                {t?.values ? (
                  <select id={`m-value-${r.key}`} value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} required className={SELECT}>
                    <option value="" disabled>
                      Choose
                    </option>
                    {t.values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`m-value-${r.key}`}
                    value={r.value}
                    onChange={(e) => update(r.key, { value: e.target.value })}
                    inputMode={r.code === OTHER ? "text" : "decimal"}
                    required
                  />
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`m-unit-${r.key}`}>Unit</Label>
                {t && t.units.length > 0 ? (
                  <select id={`m-unit-${r.key}`} value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} className={SELECT}>
                    {t.units.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input id={`m-unit-${r.key}`} value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} />
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`m-range-${r.key}`}>Lab range</Label>
                <Input id={`m-range-${r.key}`} value={r.labRange} onChange={(e) => update(r.key, { labRange: e.target.value })} placeholder="e.g. 4.0-5.6" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`m-flag-${r.key}`}>Lab flag</Label>
                <select id={`m-flag-${r.key}`} value={r.labFlag} onChange={(e) => update(r.key, { labFlag: e.target.value })} className={SELECT}>
                  {FLAGS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`m-specimen-${r.key}`}>Specimen (optional)</Label>
                <Input id={`m-specimen-${r.key}`} value={r.specimen} onChange={(e) => update(r.key, { specimen: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label htmlFor={`m-comment-${r.key}`}>Comment (optional)</Label>
                <Input id={`m-comment-${r.key}`} value={r.comment} onChange={(e) => update(r.key, { comment: e.target.value })} />
              </div>
              <div className="flex items-end">
                {rows.length > 1 ? (
                  <Button type="button" variant="outline" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setRows((rs) => [...rs, emptyRow()])} disabled={rows.length >= 60}>
          Add another result
        </Button>
      </fieldset>

      <FilePicker
        id="m-file"
        name="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        label="Attach the original (optional)"
        hint="If the laboratory sent a report as well, attach it. Otherwise a record of what you typed is kept instead."
      />
      <div className="space-y-1">
        <Label htmlFor="m-note">Note for the care team (optional, not shown to the patient)</Label>
        <Input id="m-note" name="note" maxLength={1000} />
      </div>
      {state?.error ? <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p> : null}
      {state?.success ? (
        <p className="text-sm text-green-700 dark:text-green-300">Saved. A doctor will check the values; the patient sees them once they have.</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save results for a doctor to check"}
      </Button>
    </form>
  );
}
