"use client";

import { useActionState } from "react";
import { signLabFallbackWording } from "./actions";
import { LAB_FALLBACK_WORDING } from "@/lib/lab-results/fallback-wording";
import type { LabFallbackSignoff } from "@/lib/lab-results/read-lab-fallback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TOUCH = "min-h-11";

export function LabFallbackView({ signoff, canSign }: { signoff: LabFallbackSignoff | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signLabFallbackWording, undefined);
  const signed = signoff?.approved_at != null;
  const wording = signoff ? LAB_FALLBACK_WORDING[signoff.wording_key] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(signoff!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {signed
            ? "This message can be sent when the conditions below are met."
            : "Until this is signed the message is never sent. Nothing else changes: a held sensitive result stays held either way."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The message the patient would receive (wording {signoff?.wording_key ?? "none"})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {wording ? <blockquote className="rounded-md border-l-4 border-tarragon-green bg-tarragon-green/5 p-3">{wording}.</blockquote> : <p>No wording to sign.</p>}
          <p>
            It is sent once, in the app, to a patient whose held sensitive result still needs to be disclosed in person, after the attempts
            to reach them are used up and the CMO has been told, and then after the wait set in the lab lifecycle configuration. It names no
            test, no value and no condition.
          </p>
          <p className="font-medium">It never releases a result. The value stays held until a clinician has told the patient in person.</p>
        </CardContent>
      </Card>

      {canSign && signoff && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={signoff.id} />
          <p className="text-sm text-charcoal-ink/70">
            This wording was written by the build team, not clinical advice. Signing records that you read it and agree it may be sent, under your own name.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have read the wording above and agree it may be sent.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the fallback wording</Button>
        </form>
      ) : null}
    </div>
  );
}
