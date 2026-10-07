"use client";

import { useState, type FormEvent } from "react";
import { useMyLearningCreator, useSubmitCreatorCredentials } from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUS_TEXT: Record<string, string> = {
  invited: "You have been invited. Send your credentials below.",
  pending_verification: "Your credentials are with an admin for verification. You can send them again if something changed.",
  verified: "You are verified. Your name is credited on the items you write.",
  suspended: "Your creator access is paused. Contact the clinical team.",
  declined: "Your credentials were not accepted. You can send them again.",
};

export function CreatorCredentialsForm() {
  const { data: me, isLoading, isError, refetch } = useMyLearningCreator();
  const submit = useSubmitCreatorCredentials();
  const [mdcn, setMdcn] = useState("");
  const [evidence, setEvidence] = useState("");
  const [indemnity, setIndemnity] = useState(false);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError) {
    return (
      <Card>
        <CardContent className="space-y-2 py-6 text-sm">
          <p>We could not load your creator record just now. This does not mean you were not invited.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }
  if (!me) {
    return (
      <Card>
        <CardContent className="py-6 text-sm">You have not been invited as a Learning Centre creator. Creators are invited by an admin.</CardContent>
      </Card>
    );
  }
  const canSend = me.status === "invited" || me.status === "pending_verification" || me.status === "declined";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{me.display_name}</CardTitle>
        <CardDescription>{STATUS_TEXT[me.status]}</CardDescription>
      </CardHeader>
      {canSend && (
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              submit.mutate({ mdcn, evidence, indemnity });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="cc_mdcn">MDCN registration number</Label>
              <Input id="cc_mdcn" value={mdcn} onChange={(e) => setMdcn(e.target.value)} required minLength={4} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc_evidence">Evidence of your credentials (what you can show, for example the register entry and certificate)</Label>
              <Textarea id="cc_evidence" rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} required minLength={10} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={indemnity} onChange={(e) => setIndemnity(e.target.checked)} />
              I confirm I hold professional indemnity cover for this work.
            </label>
            <Button type="submit" size="sm" disabled={submit.isPending || !indemnity}>
              Send for verification
            </Button>
            {submit.isError && <p className="text-xs text-red-600">{(submit.error as Error).message}</p>}
            {submit.isSuccess && <p className="text-xs text-charcoal-ink/70">Sent. An admin will verify it.</p>}
          </form>
        </CardContent>
      )}
    </Card>
  );
}
