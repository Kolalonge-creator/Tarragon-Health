"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestEmergencyAccessAction } from "@/lib/emergency-access/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The wall a cross-organisation lookup hits: normal RLS makes a patient
 * outside the caller's org indistinguishable from one that doesn't exist at
 * all. This panel only renders once patient_exists_cross_org has already
 * told the server the patient is real, just elsewhere -- so patientName is
 * always a genuine name here, never a guess.
 *
 * On a successful request, request_emergency_record_access grants access
 * immediately (this is an emergency -- there is nothing to wait for), so a
 * plain router.refresh() re-runs this same server component's own patient
 * lookup, which now succeeds under the new grant and renders the real chart.
 */
export function RequestEmergencyAccessPanel({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<{ expiresAt: string } | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    const res = await requestEmergencyAccessAction(patientId, reason.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const data = res.data as { expires_at?: string } | undefined;
    setGranted({ expiresAt: data?.expires_at ?? new Date().toISOString() });
    router.refresh();
  }

  if (granted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Emergency access granted</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/70">
            You can now see {patientName}&apos;s record until{" "}
            {new Date(granted.expiresAt).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Their home-organisation clinical director has been notified and will review this
            request afterward.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{patientName} is not in your organisation</CardTitle>
        <CardDescription>
          You can request time-boxed emergency access if you&apos;re treating them now. This is
          logged, expires in 8 hours, and their home-organisation clinical director reviews it
          afterward — use it for a genuine emergency, not routine care.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          placeholder="Reason (e.g. unconscious patient, treating in ED)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button size="sm" disabled={pending || reason.trim().length === 0} onClick={submit}>
          {pending ? "Requesting…" : "Request emergency access"}
        </Button>
      </CardContent>
    </Card>
  );
}
