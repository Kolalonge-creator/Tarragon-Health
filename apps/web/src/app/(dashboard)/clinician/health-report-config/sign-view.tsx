"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signHealthReportConfig, signSerologyThreshold, type SignState } from "./actions";

export type ConfigVersionRow = { id: string; version: number; is_active: boolean; approved_at: string | null; notes: string | null; config: unknown };

const TOUCH = "min-h-11";

function SignForm({ id, label, confirm, action }: { id: string; label: string; confirm: string; action: (prev: SignState, fd: FormData) => Promise<SignState> }) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="space-y-3 rounded-lg border p-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-charcoal-ink/70">These values are proposals written by the build team, not clinical advice. Signing records that you reviewed them, under your own name.</p>
      <label className="flex items-start gap-2 text-sm">
        <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
        <span>{confirm}</span>
      </label>
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
      <Button type="submit" className={TOUCH} disabled={pending}>{label}</Button>
    </form>
  );
}

function Pretty({ value }: { value: unknown }) {
  return <pre className="max-h-96 overflow-auto rounded bg-black/5 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

/** The yearly Health Report settings: the live (signed) version, and the newest unsigned draft with every value on screen next to its Sign control. */
export function HealthReportConfigView({ live, draft, canSign }: { live: ConfigVersionRow | null; draft: ConfigVersionRow | null; canSign: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={live?.approved_at ? "green" : "amber"}>{live?.approved_at ? `Version ${live.version} signed ${new Date(live.approved_at).toLocaleDateString("en-NG")}` : "No signed version"}</Badge>
        <p className="text-sm text-charcoal-ink/70">No yearly report can be built until a version is signed and its go-live guard is on.</p>
      </div>
      {live ? (
        <Card>
          <CardHeader><CardTitle className="text-base">In force: version {live.version}</CardTitle></CardHeader>
          <CardContent><Pretty value={live.config} /></CardContent>
        </Card>
      ) : null}
      {draft ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Waiting for your signature: version {draft.version}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {draft.notes ? <p className="text-sm">{draft.notes}</p> : null}
            <Pretty value={draft.config} />
            {canSign ? (
              <SignForm id={draft.id} label="Sign the report settings" confirm="I have reviewed every value above, including the suggested recheck weeks." action={signHealthReportConfig} />
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm">No newer unsigned version is waiting.</p>
      )}
    </div>
  );
}

/** The active serology rule (HIV, hepatitis B and C repeat rules and the anti-HBs threshold) with the threshold's Sign control. */
export function SerologyRulesView({ rule, thresholdSigned, canSign }: { rule: { id: string; version: number; code: string; config: unknown; notes: string | null } | null; thresholdSigned: boolean; canSign: boolean }) {
  if (!rule) return <p role="alert" className="text-sm text-red-700">No active serology rule was found.</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={thresholdSigned ? "green" : "amber"}>{thresholdSigned ? "Anti-HBs threshold confirmed" : "Anti-HBs threshold not confirmed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">Until the threshold is confirmed, a titre alone never records hepatitis B immunity; only a positive result does.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Active rule: version {rule.version} ({rule.code})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {rule.notes ? <p className="text-sm">{rule.notes}</p> : null}
          <Pretty value={rule.config} />
          {canSign && !thresholdSigned ? (
            <SignForm id={rule.id} label="Confirm the anti-HBs threshold" confirm="I have reviewed the anti-HBs threshold and the repeat rules above." action={signSerologyThreshold} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
