"use client";

import { useActionState } from "react";
import type { CuffCheckVersion } from "@/lib/cuff-check/read-cuff-check-rules";
import { signCuffCheckRules } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t">
      <th scope="row" className="py-1 pr-3 text-left font-normal">{label}</th>
      <td>{value}</td>
    </tr>
  );
}

function ConfigCard({ v, heading }: { v: CuffCheckVersion; heading: string }) {
  const c = v.config;
  if (!c) return <p role="alert" className="text-sm text-red-700">Version {v.version} does not pass the configuration check and cannot be signed.</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{heading} (version {v.version})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <table className="w-full">
          <caption className="text-left font-medium">What counts as a pair</caption>
          <tbody>
            <Row label="A same-visit pair" value="you enter the clinic reading and the reading from the patient's own cuff taken at the same visit, with a label for the device" />
            <Row label="A home-log pair" value={`made when a clinic reading is saved: the average of the patient's own home readings within ${c.pairing.windowHours} hours either side of it, and only if there are at least ${c.pairing.minHomeReadings}`} />
          </tbody>
        </table>
        <table className="w-full">
          <caption className="text-left font-medium">When the two cuffs read differently</caption>
          <tbody>
            <Row label="A pair is off when" value={`the own cuff is ${c.difference.systolic} mmHg or more above or below the clinic cuff on the top number, or ${c.difference.diastolic} mmHg or more on the bottom number`} />
            <Row label="Consistently off" value={`at least ${c.consistency.minPairs} of the newest ${c.consistency.maxPairs} pairs in the last ${c.consistency.lookbackDays} days, and at least ${c.consistency.minSharePercent} percent of the pairs looked at, off in the SAME direction`} />
            <Row label="Output" value={`one routine care-team task ("consider a cuff check"), due in ${c.tasks.reviewDueMinutes / 60 / 24} days. Never shown to the patient, never in a notification, never changes a medicine, never a diagnosis.`} />
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function CuffCheckRulesView({ live, pending, canSign }: { live: CuffCheckVersion | null; pending: CuffCheckVersion | null; canSign: boolean }) {
  const [state, action, pending_] = useActionState(signCuffCheckRules, undefined);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={live ? "green" : "amber"}>{live ? `Signed ${new Date(live.approvedAt!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {live
            ? "The rule can raise a task once its go-live guard is switched on."
            : "Until this is signed the rule cannot raise a task. Its guard is off. Every number below is a proposal, not a guideline."}
        </p>
      </div>

      {live ? <ConfigCard v={live} heading="Signed and in force" /> : null}
      {pending ? <ConfigCard v={pending} heading="Waiting for your signature" /> : null}
      {!live && !pending ? <p className="text-sm">There is no version to sign.</p> : null}

      {canSign && pending && pending.config ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={pending.id} />
          <p className="text-sm text-charcoal-ink/70">
            These numbers are proposals written into a configuration row. No guideline fixes them. Signing records that you reviewed every value above, under your own name.
            The clinician-only attestation and the neutral patient line are recorded separately.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the pairing, the difference and the consistency rule above.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className="min-h-11" disabled={pending_}>Sign the cuff check rules</Button>
        </form>
      ) : null}
    </div>
  );
}
