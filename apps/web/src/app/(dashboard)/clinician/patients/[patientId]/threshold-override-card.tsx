"use client";

import { useActionState } from "react";
import { proposeThresholdOverride, revokeThresholdOverride, signThresholdOverride } from "./threshold-override-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PatientOverrideRow } from "@/lib/queries/threshold-overrides";

function describe(row: PatientOverrideRow): string {
  const p = row.params as { target?: { systolic: number; diastolic: number }; lowAmberSystolic?: number; hypoAlertMmol?: number; hypoSevereMmol?: number };
  const parts = [
    p.target && `blood pressure target ${p.target.systolic}/${p.target.diastolic}`,
    p.lowAmberSystolic !== undefined && `flag a low reading with no symptom under ${p.lowAmberSystolic}`,
    p.hypoAlertMmol !== undefined && `treat-now low line ${p.hypoAlertMmol} mmol/L`,
    p.hypoSevereMmol !== undefined && `red low line ${p.hypoSevereMmol} mmol/L`,
  ].filter(Boolean);
  return parts.join("; ");
}

function Existing({ row, patientId }: { row: PatientOverrideRow; patientId: string }) {
  const [signState, sign, signing] = useActionState(signThresholdOverride, undefined);
  const [endState, end, ending] = useActionState(revokeThresholdOverride, undefined);
  return (
    <li className="space-y-2 rounded-lg border border-charcoal-ink/15 p-3 text-sm">
      <p className="font-medium text-charcoal-ink">
        {row.domain === "bp" ? "Blood pressure" : "Glucose"}: {describe(row)}{" "}
        <span className="rounded bg-charcoal-ink/10 px-1.5 py-0.5 text-xs">{row.status === "active" ? "signed and live" : "proposed, not signed, no effect yet"}</span>
      </p>
      <p className="text-charcoal-ink/70">Reason: {row.reason}</p>
      {row.status === "active" && row.expires_at ? (
        <p className="text-charcoal-ink/70">Returns to the default on {new Date(row.expires_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}. Monthly review due {row.review_due_at ? new Date(row.review_due_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" }) : "-"}.</p>
      ) : (
        <p className="text-charcoal-ink/70">Review period {row.valid_days} days once signed.</p>
      )}
      {row.status === "draft" ? (
        <form action={sign} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="override_id" value={row.id} />
          <input type="hidden" name="patient_id" value={patientId} />
          <label className="flex items-start gap-2 text-charcoal-ink"><input type="checkbox" name="understood" required className="mt-1" /><span>I have read this setting and sign it as my clinical decision.</span></label>
          <div className="space-y-1"><Label htmlFor={`sign-${row.id}`}>Type SIGN</Label><Input id={`sign-${row.id}`} name="typed" autoComplete="off" required className="w-28 uppercase" /></div>
          <Button type="submit" disabled={signing} className="min-h-11">Sign</Button>
          {signState?.error ? <p role="alert" className="w-full text-red-700">{signState.error}</p> : null}
          {signState?.success ? <p role="status" className="w-full text-green-800">{signState.success}</p> : null}
        </form>
      ) : null}
      <form action={end} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="override_id" value={row.id} />
        <input type="hidden" name="patient_id" value={patientId} />
        <div className="space-y-1"><Label htmlFor={`end-${row.id}`}>Reason to end it</Label><Input id={`end-${row.id}`} name="reason" required minLength={5} className="w-64" /></div>
        <Button type="submit" variant="outline" disabled={ending} className="min-h-11">End it now</Button>
        {endState?.error ? <p role="alert" className="w-full text-red-700">{endState.error}</p> : null}
        {endState?.success ? <p role="status" className="w-full text-green-800">{endState.success}</p> : null}
      </form>
    </li>
  );
}

/**
 * Personal triage thresholds (senior doctors tied to this patient). Everything here is bounded: a personal setting can calm two routine
 * amber alerts or make the checks more sensitive, and can never lower a red, relax a symptom or apply in pregnancy, the first six weeks after a birth or under 18.
 */
export function ThresholdOverrideCard({ patientId, rows, readFailed }: { patientId: string; rows: PatientOverrideRow[]; readFailed: boolean }) {
  const [state, action, pending] = useActionState(proposeThresholdOverride, undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal alert thresholds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          For a patient whose usual readings sit outside the standard lines (a long-standing higher blood pressure, kidney disease, or lows they cannot feel). Nothing here lowers a red alert
          or relaxes a reading that comes with a symptom. A setting expires on its own and is reviewed monthly by the Chief Medical Officer. The patient is told only that the care team set personal targets, never the numbers.
        </p>
        {readFailed ? <p role="alert" className="text-sm text-red-700">The existing settings could not be read. Do not assume there are none.</p> : null}
        {rows.length > 0 ? <ul className="space-y-3">{rows.map((r) => <Existing key={r.id} row={r} patientId={patientId} />)}</ul> : null}
        <form action={action} className="space-y-4 border-t border-charcoal-ink/10 pt-4">
          <input type="hidden" name="patient_id" value={patientId} />
          <div className="space-y-1.5">
            <Label htmlFor="to-domain">Which checks</Label>
            <select id="to-domain" name="domain" className="min-h-11 rounded-md border border-charcoal-ink/20 px-3 text-sm" defaultValue="bp">
              <option value="bp">Blood pressure</option>
              <option value="glucose">Glucose (low lines only)</option>
            </select>
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="text-sm font-medium text-charcoal-ink">Blood pressure (leave blank what you do not change)</legend>
            <div className="space-y-1.5"><Label htmlFor="to-sys">Target systolic (100 to 160)</Label><Input id="to-sys" name="bp_target_systolic" type="number" inputMode="numeric" min={100} max={160} /></div>
            <div className="space-y-1.5"><Label htmlFor="to-dia">Target diastolic (60 to 100)</Label><Input id="to-dia" name="bp_target_diastolic" type="number" inputMode="numeric" min={60} max={100} /></div>
            <div className="space-y-1.5"><Label htmlFor="to-low">Flag a low reading with no symptom under (80 to 90)</Label><Input id="to-low" name="bp_low_amber" type="number" inputMode="numeric" min={80} max={90} /></div>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="text-sm font-medium text-charcoal-ink">Glucose, mmol/L (these only make the checks more sensitive)</legend>
            <div className="space-y-1.5"><Label htmlFor="to-alert">Treat-now low line (3.9 to 5.0)</Label><Input id="to-alert" name="glucose_alert" type="number" step="0.1" min={3.9} max={5.0} /></div>
            <div className="space-y-1.5"><Label htmlFor="to-severe">Red low line (3.0 to 3.5)</Label><Input id="to-severe" name="glucose_severe" type="number" step="0.1" min={3.0} max={3.5} /></div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="to-reason">Clinical reason</Label><Input id="to-reason" name="reason" required minLength={10} maxLength={1000} /></div>
            <div className="space-y-1.5"><Label htmlFor="to-days">Runs for (days, then back to default)</Label><Input id="to-days" name="days" type="number" inputMode="numeric" min={1} max={180} defaultValue={60} required /></div>
          </div>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">{state.success}</p> : null}
          <Button type="submit" className="min-h-11" disabled={pending}>Propose (does nothing until signed)</Button>
        </form>
      </CardContent>
    </Card>
  );
}
