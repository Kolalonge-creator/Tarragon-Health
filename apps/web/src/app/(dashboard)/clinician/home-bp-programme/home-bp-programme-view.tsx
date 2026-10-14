"use client";

import { useActionState } from "react";
import type { HomeBpVersion } from "@/lib/home-bp/read-home-bp-programme";
import { signHomeBpProgramme } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TOUCH = "min-h-11";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t">
      <th scope="row" className="py-1 pr-3 text-left font-normal">{label}</th>
      <td>{value}</td>
    </tr>
  );
}

function ConfigCard({ v, heading }: { v: HomeBpVersion; heading: string }) {
  const c = v.config;
  if (!c) return <p role="alert" className="text-sm text-red-700">Version {v.version} does not pass the configuration check and cannot be signed.</p>;
  const hours = (r: readonly [number, number]) => `${r[0]}:00 to ${r[1] === 24 ? "24:00" : `${r[1]}:00`}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{heading} (version {v.version})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <table className="w-full">
          <caption className="text-left font-medium">C1. The protocol</caption>
          <tbody>
            <Row label="Readings per session" value={`${c.protocol.readingsPerSession}, at least ${c.protocol.minGapMinutes} minute apart`} />
            <Row label="Sessions" value={`morning (${hours(c.protocol.morningHours)}) and evening (${hours(c.protocol.eveningHours)}), Lagos time`} />
            <Row label="Target" value={`${c.protocol.targetDays} days`} />
            <Row label="A complete average needs" value={`at least ${c.protocol.minReadings} readings over at least ${c.protocol.minDays} days; every reading is averaged. Below that: "not enough readings yet".`} />
            <Row label="Before measuring" value={`rest ${c.protocol.restMinutes} minutes; nothing in the ${c.protocol.avoidBeforeMinutes} minutes before`} />
          </tbody>
        </table>
        <table className="w-full">
          <caption className="text-left font-medium">C2. The bands for a complete home average</caption>
          <tbody>
            <Row label="Above the home hypertension level" value={`${c.bands.aboveSystolic}/${c.bands.aboveDiastolic} or above (either number)`} />
            <Row label="Borderline" value={`${c.bands.borderlineSystolic}/${c.bands.borderlineDiastolic} or above, below the line above`} />
            <Row label="Within the home target" value="below the borderline numbers" />
          </tbody>
        </table>
        <table className="w-full">
          <caption className="text-left font-medium">C3. The clinician-only pattern rule (behind its own go-live guard)</caption>
          <tbody>
            <Row label="Clinic reading counts as raised at" value={`${c.pattern.clinicSystolic}/${c.pattern.clinicDiastolic} or above (either number)`} />
            <Row label="Possible masked pattern" value="clinic below that line and home average above the home level (called masked uncontrolled when taking blood pressure medicines)" />
            <Row label="Possible white-coat pattern" value="clinic at or above that line and home average below the home level, only when not taking blood pressure medicines" />
            <Row label="Window" value={`the clinic reading and the home average within ${c.pattern.windowDays} days of each other`} />
            <Row label="Output" value="one routine care-team task, never shown to the patient, never in a notification, never changes a medicine. Not applied in pregnancy or under 18." />
          </tbody>
        </table>
        <p>Review tasks are due in {c.tasks.reviewDueMinutes / 60} hours (home check) and {c.tasks.patternDueMinutes / 60} hours (pattern).</p>
      </CardContent>
    </Card>
  );
}

export function HomeBpProgrammeView({ live, pending, canSign }: { live: HomeBpVersion | null; pending: HomeBpVersion | null; canSign: boolean }) {
  const [state, action, pending_] = useActionState(signHomeBpProgramme, undefined);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={live ? "green" : "amber"}>{live ? `Signed ${new Date(live.approvedAt!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {live
            ? "The home check can record a result once the go-live guards are switched on."
            : "Until this is signed the home check cannot record a result or open a task, and the pattern rule cannot raise one. Both guards are off."}
        </p>
      </div>

      {live ? <ConfigCard v={live} heading="Signed and in force" /> : null}
      {pending ? <ConfigCard v={pending} heading="Waiting for your signature" /> : null}
      {!live && !pending ? <p className="text-sm">There is no version to sign.</p> : null}

      {canSign && pending && pending.config ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={pending.id} />
          <p className="text-sm text-charcoal-ink/70">
            These values are the text you approved in chat on 7 October 2026 (C1, C2, C3), written into a configuration row. Signing records that you reviewed every value above, under your own name. The patient wording (C4) and the low blood pressure line (C5, a draft triage rule set) are signed separately.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the protocol, the bands and the pattern rule above.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending_}>Sign the home blood pressure programme</Button>
        </form>
      ) : null}
    </div>
  );
}
