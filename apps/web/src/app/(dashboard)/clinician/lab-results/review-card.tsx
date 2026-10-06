"use client";

import { useActionState, useState, useTransition } from "react";
import {
  getReviewFileUrl,
  openLabResult,
  recordDisclosure,
  releaseResult,
  withholdResult,
} from "@/lib/lab-results/structured-actions";
import { formatRange, type ReviewResult } from "@/lib/lab-results/structured";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TOUCH = "min-h-11";
const FLAG_VARIANT = { normal: "green", low: "amber", high: "amber", critical: "red", positive: "amber", negative: "green" } as const;

export type ReviewSummary = { id: string; state: string; reason: string | null; receivedAt: string };

/** A queued result, closed. Opening it is the audited read; nothing about the patient is shown until then. */
export function ReviewCard({ summary }: { summary: ReviewSummary }) {
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const disclosure = summary.state === "clinician_disclosure_required";
  const label = disclosure ? "Disclose in person" : summary.reason === "critical" ? "Critical value" : "Held for review";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Received {new Date(summary.receivedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</CardTitle>
        <Badge variant={disclosure || summary.reason === "critical" ? "red" : "amber"}>{label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {result ? (
          <ReviewBody result={result} />
        ) : (
          <>
            <Button
              type="button"
              className={TOUCH}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await openLabResult(summary.id);
                  if (r.result) setResult(r.result);
                  setError(r.error ?? null);
                })
              }
            >
              Open this result
            </Button>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewBody({ result }: { result: ReviewResult }) {
  const disclosure = result.release_state === "clinician_disclosure_required";
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">

        {result.items.length > 0 ? (
          <table className="w-full text-sm">
            <caption className="sr-only">Values entered by the lab</caption>
            <thead>
              <tr className="text-left text-charcoal-ink/60">
                <th scope="col" className="py-1">Test</th>
                <th scope="col">Value</th>
                <th scope="col">Reference</th>
                <th scope="col">Flag</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((i) => (
                <tr key={i.analyte_code} className="border-t">
                  <td className="py-1">{i.analyte_code.replace(/_/g, " ")}</td>
                  <td>{i.value_numeric !== null ? `${i.value_numeric} ${i.unit}` : i.value_text}</td>
                  <td>{formatRange(i.ref_low, i.ref_high, i.unit)}</td>
                  <td><Badge variant={FLAG_VARIANT[i.flag]}>{i.sensitive_positive ? "positive (sensitive)" : i.flag}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-charcoal-ink/70">No values were entered. Read the report and decide.</p>
        )}

        {result.file_path ? (
          <div>
            <Button
              type="button"
              variant="outline"
              className={TOUCH}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await getReviewFileUrl(result.lab_result_id);
                  if (r.url) window.open(r.url, "_blank", "noopener");
                  setFileError(r.error ?? null);
                })
              }
            >
              Open the lab report
            </Button>
            {fileError ? <p role="alert" className="mt-1 text-sm text-red-700">{fileError}</p> : null}
          </div>
        ) : null}

        {disclosure ? <DisclosureForm id={result.lab_result_id} /> : <ReleaseForm id={result.lab_result_id} />}
        <WithholdForm id={result.lab_result_id} />
    </div>
  );
}

function ReleaseForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(releaseResult, undefined);
  return (
    <form action={action} className="space-y-2 border-t pt-3">
      <input type="hidden" name="result_id" value={id} />
      <Label htmlFor={`rn-${id}`}>Note for the record (optional)</Label>
      <Textarea id={`rn-${id}`} name="note" rows={2} maxLength={500} />
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">Released. The patient has a neutral notice.</p> : null}
      <Button type="submit" className={TOUCH} disabled={pending}>Release to the patient</Button>
    </form>
  );
}

function DisclosureForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(recordDisclosure, undefined);
  return (
    <form action={action} className="space-y-2 border-t pt-3">
      <input type="hidden" name="result_id" value={id} />
      <p className="text-sm text-charcoal-ink/70">
        Tell the patient yourself first, with the support they need. Nothing is explained by audio or by AI. Record it here only
        after you have spoken with them.
      </p>
      <Label htmlFor={`dm-${id}`}>How did you tell them?</Label>
      <Select id={`dm-${id}`} name="method" defaultValue="" required className={TOUCH}>
        <option value="" disabled>Choose</option>
        <option value="in_person">In person</option>
        <option value="phone">By phone</option>
        <option value="video">By video</option>
      </Select>
      <label className="flex items-start gap-2 text-sm">
        <Input type="checkbox" name="attested" className="mt-1 h-5 w-5" />
        <span>I have told the patient this result myself.</span>
      </label>
      <Label htmlFor={`dn-${id}`}>Note (optional)</Label>
      <Textarea id={`dn-${id}`} name="note" rows={2} maxLength={500} />
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">Recorded.</p> : null}
      <Button type="submit" className={TOUCH} disabled={pending}>Record the disclosure</Button>
    </form>
  );
}

function WithholdForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(withholdResult, undefined);
  if (!open) {
    return (
      <Button type="button" variant="ghost" className={TOUCH} onClick={() => setOpen(true)}>
        Hold back (wrong patient or lab error)
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-2 border-t pt-3">
      <input type="hidden" name="result_id" value={id} />
      <Label htmlFor={`wr-${id}`}>Reason</Label>
      <Textarea id={`wr-${id}`} name="reason" rows={2} maxLength={500} required />
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">Held back.</p> : null}
      <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>Hold this result back</Button>
    </form>
  );
}
