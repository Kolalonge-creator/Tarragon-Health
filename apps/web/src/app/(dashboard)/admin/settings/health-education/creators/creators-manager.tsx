"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  useInviteLearningCreator,
  useLearningCreators,
  useReinstateLearningCreator,
  useSuspendLearningCreator,
  useVerifyLearningCreator,
  type LearningCreator,
} from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const STATUS: Record<LearningCreator["status"], { label: string; variant: "grey" | "amber" | "green" | "blue" }> = {
  invited: { label: "Invited, no credentials yet", variant: "grey" },
  pending_verification: { label: "Waiting for verification", variant: "amber" },
  verified: { label: "Verified", variant: "green" },
  suspended: { label: "Suspended", variant: "amber" },
  declined: { label: "Declined", variant: "grey" },
};

function useClinicianProfiles() {
  return useQuery({
    queryKey: ["learning-creator-clinicians"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("profiles").select("id, full_name").eq("role", "clinician").order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function CreatorRow({ creator }: { creator: LearningCreator }) {
  const verify = useVerifyLearningCreator();
  const suspend = useSuspendLearningCreator();
  const reinstate = useReinstateLearningCreator();
  const [reason, setReason] = useState("");
  const badge = STATUS[creator.status];
  const error = (verify.error ?? suspend.error ?? reinstate.error) as Error | null;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">{creator.display_name}</p>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        MDCN: {creator.mdcn_number ?? "not given"} · Indemnity: {creator.indemnity_confirmed ? "confirmed by the clinician" : "not confirmed"}
      </p>
      {creator.credential_evidence && <p className="text-xs text-charcoal-ink/70">Evidence: {creator.credential_evidence}</p>}
      {creator.status_note && <p className="text-xs text-charcoal-ink/60">Note: {creator.status_note}</p>}
      {creator.status === "invited" && (
        <p className="text-xs text-charcoal-ink/70">
          Tell the clinician to open Learning creator credentials at /clinician/learning-creator (no notice is sent automatically). You can withdraw the invitation below.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {creator.status === "pending_verification" && (
          <Button size="sm" disabled={verify.isPending} onClick={() => verify.mutate({ id: creator.id })}>
            Verify (I have checked the MDCN register and the evidence)
          </Button>
        )}
        {(creator.status === "verified" || creator.status === "pending_verification" || creator.status === "invited") && (
          <>
            <div className="space-y-1">
              <Label htmlFor={`reason-${creator.id}`} className="text-xs">Reason (10+ characters)</Label>
              <Input id={`reason-${creator.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-64 text-xs" />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={suspend.isPending || reason.trim().length < 10}
              onClick={() => suspend.mutate({ id: creator.id, reason, decline: creator.status !== "verified" })}
            >
              {creator.status === "verified" ? "Suspend and take their content down" : creator.status === "invited" ? "Withdraw the invitation" : "Decline"}
            </Button>
          </>
        )}
      </div>
      {(creator.status === "suspended" || creator.status === "declined") && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`back-${creator.id}`} className="text-xs">Reinstate: note (10+ characters). They must be verified again.</Label>
            <Input id={`back-${creator.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-64 text-xs" />
          </div>
          <Button size="sm" variant="outline" disabled={reinstate.isPending || reason.trim().length < 10} onClick={() => reinstate.mutate({ id: creator.id, note: reason })}>
            Reinstate to waiting for verification
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error.message}</p>}
      {suspend.isSuccess && <p className="text-xs text-charcoal-ink/60">{suspend.data} published item(s) taken down for re-review.</p>}
    </li>
  );
}

export function CreatorsManager() {
  const { data: creators, isLoading, isError } = useLearningCreators();
  const { data: clinicians } = useClinicianProfiles();
  const invite = useInviteLearningCreator();
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite a clinician</CardTitle>
          <CardDescription>
            Creators are invited, never self-registered. The clinician then submits their MDCN number, evidence of their credentials and an
            indemnity confirmation; a different admin verifies. Everything they write is still clinically reviewed before it is published,
            and is credited to them by name. Revenue share is not built: it needs a founder decision first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate({ profileId, displayName: name }, { onSuccess: () => { setProfileId(""); setName(""); } });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="creator_profile">Clinician login</Label>
              <Select id="creator_profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} required>
                <option value="">Choose</option>
                {(clinicians ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="creator_name">Name to credit (as it will appear)</Label>
              <Input id="creator_name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <Button type="submit" size="sm" disabled={invite.isPending || !profileId}>Invite</Button>
          </form>
          {invite.isError && <p className="mt-2 text-xs text-red-600">{(invite.error as Error).message}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Creators</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load creators.</p>}
          {creators && creators.length === 0 && <p className="text-sm text-charcoal-ink/60">No creators yet.</p>}
          {creators && creators.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {creators.map((c) => (
                <CreatorRow key={c.id} creator={c} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
