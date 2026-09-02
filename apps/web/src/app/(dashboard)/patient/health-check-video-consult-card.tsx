"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmHealthCheckVideoConsultSlot } from "./health-check-video-consult-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type VideoConsultInfo = {
  id: string;
  proposed_slots: string[] | null;
  scheduled_at: string | null;
} | null;

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Patient side of the bundled Screen-tier video consult (every tier since
 * 20260829140114_health_check_video_consult_all_tiers.sql — previously
 * Comprehensive Screen only, and previously a dead end on every tier: the
 * clinician could offer times but nothing let a patient pick one). Renders
 * nothing until the doctor has offered at least one time.
 */
export function HealthCheckVideoConsultCard({ consult }: { consult: VideoConsultInfo }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!consult) return null;

  if (consult.scheduled_at) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your video consult</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-charcoal-ink/80">Confirmed for {formatSlot(consult.scheduled_at)}.</p>
          <Button asChild size="sm">
            <Link href={`/patient/video-visit/${consult.id}`}>Go to your video visit</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!consult.proposed_slots || consult.proposed_slots.length === 0) return null;

  const pick = async (slot: string) => {
    setPending(slot);
    setError(null);
    const result = await confirmHealthCheckVideoConsultSlot(consult.id, slot);
    setPending(null);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pick a time for your video consult</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-charcoal-ink/70">
          Your doctor is ready to walk you through your results. Pick whichever works for you.
        </p>
        <div className="flex flex-wrap gap-2">
          {consult.proposed_slots.map((slot) => (
            <Button
              key={slot}
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={() => pick(slot)}
            >
              {pending === slot ? "Confirming…" : formatSlot(slot)}
            </Button>
          ))}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
