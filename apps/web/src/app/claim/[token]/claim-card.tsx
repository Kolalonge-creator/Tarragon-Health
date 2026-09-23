"use client";

import { useState } from "react";
import Link from "next/link";
import { koboToNaira } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { claimReservation, type ClaimReservationState } from "./actions";

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

export function ClaimCard({ token }: { token: string }) {
  const [state, setState] = useState<ClaimReservationState>(undefined);
  const [pending, setPending] = useState(false);

  async function handleClaim() {
    setPending(true);
    try {
      setState(await claimReservation(token));
    } finally {
      setPending(false);
    }
  }

  if (state && "ok" in state) {
    return (
      <Card className="border-brand-green/40 bg-brand-green/5 dark:bg-brand-green/10">
        <CardHeader>
          <CardTitle>It&apos;s yours</CardTitle>
          <CardDescription>
            {state.skuName} ({naira(state.faceValueKobo)}) is now on your account, voucher{" "}
            {state.voucherNumber}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/patient/finances">
            <Button type="button">Go to My finances</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Someone paid for care for you</CardTitle>
        <CardDescription>
          Claim it and it lands on your account right away, ready to use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state && "error" in state && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
        )}
        <Button type="button" onClick={handleClaim} disabled={pending}>
          {pending ? "Claiming…" : "Claim it"}
        </Button>
      </CardContent>
    </Card>
  );
}
