"use client";

import { useState, type FormEvent } from "react";
import { useJoinWithEmployerCode } from "@/lib/queries/employer-accounts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Module 26 §26.4 — the organisation-code self-serve join route. Only shown
 * to a patient not already attached to a real employer/HMO/clinic (the
 * caller checks that before rendering this — see public.employer_join_with_code,
 * which enforces the same rule server-side regardless). */
export function JoinEmployerCodeForm() {
  const joinWithCode = useJoinWithEmployerCode();
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    joinWithCode.mutate(code.trim(), { onSuccess: () => setJoined(true) });
  }

  if (joined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Employer programme joined</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-green-700">You&apos;re now enrolled. Reload to see any benefits it includes.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join an employer programme</CardTitle>
        <CardDescription>Have an organisation code from your employer? Enter it here to join.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="employer_code">Organisation code</Label>
            <Input
              id="employer_code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              className="font-mono uppercase tracking-widest"
              maxLength={8}
            />
          </div>
          <Button type="submit" size="sm" disabled={joinWithCode.isPending}>
            {joinWithCode.isPending ? "Joining…" : "Join"}
          </Button>
        </form>
        {joinWithCode.error && (
          <p className="mt-2 text-sm text-red-600">{(joinWithCode.error as Error).message}</p>
        )}
      </CardContent>
    </Card>
  );
}
