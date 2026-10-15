"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HELD_READING_COPY } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SourceBadge } from "@/components/source-badge";

/**
 * "Please check this reading" (S70a, 18.9). A value that cannot be real (an error code from a device, a unit slip, a typing slip) is held by
 * the database instead of being saved or triaged. It waits here for the person: enter it again, or leave it out. Nothing about it reaches the
 * care team until a real reading replaces it. The card shows nothing at all when nothing is held.
 *
 * It never says what the number means. The safety line is always there, because a held value must never leave someone who is unwell
 * thinking "the app dealt with it".
 */
interface HeldRow {
  id: string;
  vital_type: string;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function describeHeld(row: Pick<HeldRow, "vital_type" | "payload">): string {
  const p = row.payload;
  switch (row.vital_type) {
    case "blood_pressure":
      return `${p.systolic ?? "?"}/${p.diastolic ?? "?"} mmHg`;
    case "glucose":
      return `${p.glucose_mmol_l ?? "?"} mmol/L`;
    case "weight":
      return `${p.weight_kg ?? "?"} kg`;
    case "pulse":
      return `${p.pulse_bpm ?? "?"} bpm`;
    case "temperature":
      return `${p.temperature_c ?? "?"} °C`;
    case "spo2":
      return `${p.spo2_pct ?? "?"}%`;
    default:
      return "a reading";
  }
}

export function HeldReadingsCard({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const key = ["held-readings", patientId];
  const { data, isError } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data: rows, error } = await createClient()
        .from("vitals_readings_held")
        .select("id, vital_type, source, payload, created_at")
        .eq("patient_id", patientId)
        .eq("state", "pending")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (rows ?? []) as HeldRow[];
    },
    retry: false,
    enabled: !!patientId,
  });
  const discard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().rpc("resolve_held_reading", { p_id: id, p_state: "discarded" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (isError) {
    return <p className="text-sm text-red-600 dark:text-red-300">We could not check for readings waiting for you. This is not the same as there being none.</p>;
  }
  if (!data || data.length === 0) return null;

  return (
    <Card data-testid="held-readings-card">
      <CardHeader>
        <CardTitle>{HELD_READING_COPY.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{HELD_READING_COPY.body}</p>
        <ul className="space-y-3">
          {data.map((row) => (
            <li key={row.id} className="rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                {describeHeld(row)}
                <SourceBadge source={row.source} />
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/patient/vitals">{HELD_READING_COPY.retry}</Link>
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={discard.isPending} onClick={() => discard.mutate(row.id)}>
                  {HELD_READING_COPY.discard}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {discard.isError && <p className="text-sm text-red-600 dark:text-red-300">That did not work. Nothing was changed. Try again.</p>}
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">If you feel unwell, do not wait for a new reading. Get care now.</p>
      </CardContent>
    </Card>
  );
}
