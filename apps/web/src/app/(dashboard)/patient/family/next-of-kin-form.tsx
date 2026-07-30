"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  nominateNextOfKinAction,
  revokeCareAccessAction,
  cancelCareAccessRequestAction,
} from "./care-access-actions";
import {
  NEXT_OF_KIN_RELATIONSHIPS,
  nominateNextOfKinSchema,
} from "@/lib/validation/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const RELATIONSHIP_LABEL: Record<string, string> = {
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
};

export interface NextOfKinState {
  name: string | null;
  phone: string | null;
  relationship: string | null;
  /** id of the profile_access grant, once the next of kin has accepted. */
  grantId: string | null;
  /** id of the pending care_access_requests row, while waiting on them. */
  pendingRequestId: string | null;
}

export function NextOfKinForm({ current }: { current: NextOfKinState }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(current.name ?? "");
  const [phone, setPhone] = useState(current.phone ?? "");
  const [relationship, setRelationship] = useState(current.relationship ?? "child");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = nominateNextOfKinSchema.safeParse({
      full_name: fullName,
      phone,
      relationship,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid details");
      return;
    }

    setIsPending(true);
    try {
      const result = await nominateNextOfKinAction(parsed.data);
      if ("error" in result) setError(result.error);
      else {
        setSuccess(result.message);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleRevoke() {
    if (!current.grantId) return;
    setError(null);
    setSuccess(null);
    setIsPending(true);
    try {
      const result = await revokeCareAccessAction(current.grantId);
      if ("error" in result) setError(result.error);
      else {
        setSuccess(result.message);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleCancelRequest() {
    if (!current.pendingRequestId) return;
    setError(null);
    setSuccess(null);
    setIsPending(true);
    try {
      const result = await cancelCareAccessRequestAction(current.pendingRequestId);
      if ("error" in result) setError(result.error);
      else {
        setSuccess(result.message);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your next of kin</CardTitle>
        <CardDescription>
          One person we contact if something urgent comes up. If they have a Tarragon account of
          their own, we&apos;ll ask them to confirm before they can also follow your care: see
          your readings, appointments and results. They can never change anything on your record,
          and either of you can withdraw access at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-brand-green">{success}</p>}

        {current.name && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-charcoal-ink/10 p-3">
            <div>
              <p className="text-sm font-medium text-charcoal-ink">{current.name}</p>
              <p className="text-xs text-charcoal-ink/60">
                {RELATIONSHIP_LABEL[current.relationship ?? "other"] ?? current.relationship} ·{" "}
                {current.phone}
                {current.grantId
                  ? " · can view your care"
                  : current.pendingRequestId
                    ? " · waiting for them to accept"
                    : " · contact only, no Tarragon account on this number"}
              </p>
            </div>
            {current.grantId && (
              <Button size="sm" variant="outline" disabled={isPending} onClick={handleRevoke}>
                Withdraw access
              </Button>
            )}
            {current.pendingRequestId && (
              <Button size="sm" variant="outline" disabled={isPending} onClick={handleCancelRequest}>
                Withdraw request
              </Button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nok_full_name">Their name</Label>
              <Input
                id="nok_full_name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nok_relationship">Relationship to you</Label>
              <Select
                id="nok_relationship"
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
              >
                {NEXT_OF_KIN_RELATIONSHIPS.map((value) => (
                  <option key={value} value={value}>
                    {RELATIONSHIP_LABEL[value]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nok_phone">Their phone number</Label>
            <Input
              id="nok_phone"
              placeholder="+2348012345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
            <p className="text-xs text-charcoal-ink/60">
              If this number belongs to a Tarragon account, they&apos;ll be able to follow your
              care straight away.
            </p>
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : current.name ? "Update next of kin" : "Save next of kin"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
