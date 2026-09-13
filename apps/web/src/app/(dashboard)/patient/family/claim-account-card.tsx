"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { claimDependentAccountAction } from "./claim-dependent-actions";
import { claimDependentAccountSchema } from "@/lib/validation/elder-proxy-dependent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The claim form itself, shared by the two places it's offered:
 * MaturedDependentBanner (a minor_child the daily majority-review sweep has
 * flagged as 18+) and AdultsYouManageList (an elder_proxy dependant, claimable
 * any time since they consented up front at creation rather than reaching an
 * age threshold — see claim-dependent-actions.ts for what actually changes on
 * submit, and why the two kinds need different eligibility gates but share
 * this exact mechanism and form).
 */
export function ClaimAccountCard({
  dependentId,
  title,
  description,
  buttonLabel = "Give them their own login",
  invalidateQueryKey,
}: {
  dependentId: string;
  title: string;
  description: string;
  buttonLabel?: string;
  invalidateQueryKey: readonly unknown[];
}) {
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
        await queryClient.invalidateQueries({ queryKey: invalidateQueryKey });
      }
    } finally {
      setIsPending(false);
    }
  }

  if (success) {
    return (
      <Card className="border-brand-green/40 bg-brand-green/5 dark:bg-brand-green/10">
        <CardContent className="pt-6">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">{success}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-400/50 bg-amber-50/60 dark:bg-amber-500/10">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
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
            {isPending ? "Setting up…" : buttonLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
