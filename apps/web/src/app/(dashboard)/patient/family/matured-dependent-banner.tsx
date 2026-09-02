"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useManagedDependents } from "@/lib/queries/care-access";
import { claimDependentAccountAction } from "./claim-dependent-actions";
import { claimDependentAccountSchema } from "@/lib/validation/elder-proxy-dependent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A managed child dependent private.sweep_dependent_majority_review
 * (20260829082711) has flagged as 18+. Renders one card per flagged
 * dependent — usually zero, since most children stay under 18 for years —
 * offering the one action that matters: give them their own login. See
 * claim-dependent-actions.ts for what that actually changes.
 */
export function MaturedDependentBanner() {
  const { data: dependants } = useManagedDependents();
  const matured = (dependants ?? []).filter((d) => d.majority_review_at !== null);

  if (matured.length === 0) return null;

  return (
    <div className="space-y-4">
      {matured.map((dependent) => (
        <ClaimCard key={dependent.id} dependentId={dependent.id} name={dependent.full_name} />
      ))}
    </div>
  );
}

function ClaimCard({ dependentId, name }: { dependentId: string; name: string | null }) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = claimDependentAccountSchema.safeParse({ dependent_id: dependentId, phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid details");
      return;
    }

    setIsPending(true);
    try {
      const result = await claimDependentAccountAction(parsed.data);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSuccess(result.message);
        await queryClient.invalidateQueries({ queryKey: ["managed-dependents"] });
      }
    } finally {
      setIsPending(false);
    }
  }

  if (success) {
    return (
      <Card className="border-brand-green/40 bg-brand-green/5">
        <CardContent className="pt-6">
          <p className="text-sm text-charcoal-ink">{success}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-400/50 bg-amber-50/60">
      <CardHeader>
        <CardTitle className="text-lg">{name ?? "They"} turned 18</CardTitle>
        <CardDescription>
          Give them their own Tarragon login with their real phone number, or keep helping as-is for
          now — you can do this whenever you&apos;re ready.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          {error && <p className="w-full text-sm text-red-600">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor={`claim_phone_${dependentId}`}>Their phone number</Label>
            <Input
              id={`claim_phone_${dependentId}`}
              type="tel"
              placeholder="+2348012345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Setting up…" : "Give them their own login"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
