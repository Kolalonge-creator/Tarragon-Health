"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { proposeHealthCheckVideoConsultSlots } from "./health-check-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VideoConsultInfo = {
  id: string;
  proposed_slots: string[] | null;
  scheduled_at: string | null;
} | null;

function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
 * Clinician side of the bundled Screen-tier video consult (every tier since
 * 20260829140114_health_check_video_consult_all_tiers.sql — previously
 * Comprehensive Screen only): offer 1-3 candidate times once the Screen
 * order has resulted and created the consult row. Mirrors the retired
 * annual-reviews page's ConsultProposer, but reads/writes the row via
 * annual_health_checks.video_consultation_id instead of the retired
 * annual_reviews table.
 */
export function HealthCheckVideoConsult({ consult }: { consult: VideoConsultInfo }) {
  const router = useRouter();
  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!consult) return null;

  if (consult.scheduled_at) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Health check: video consult</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-charcoal-ink/70">
          Confirmed for {formatSlot(consult.scheduled_at)}.
        </CardContent>
      </Card>
    );
  }

  if ((consult.proposed_slots?.length ?? 0) > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Health check: video consult</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-charcoal-ink/70">
          {consult.proposed_slots?.length} time(s) offered, awaiting the patient&apos;s pick.
        </CardContent>
      </Card>
    );
  }

  const submit = async () => {
    const iso = slots.map(toIso).filter((s): s is string => Boolean(s));
    if (iso.length === 0) {
      setError("Enter at least one time.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await proposeHealthCheckVideoConsultSlots(consult.id, iso);
    setPending(false);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Health check: video consult</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
          Offer video consult times
        </p>
        <div className="flex flex-wrap gap-2">
          {slots.map((value, i) => (
            <Input
              key={i}
              type="datetime-local"
              value={value}
              onChange={(e) =>
                setSlots((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
              }
              className="h-8 w-auto text-xs"
            />
          ))}
          <Button size="sm" disabled={pending} onClick={submit}>
            {pending ? "Offering…" : "Offer times"}
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
