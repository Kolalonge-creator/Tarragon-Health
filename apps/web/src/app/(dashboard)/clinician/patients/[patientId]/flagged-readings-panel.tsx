"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFlaggedVitalsReadings } from "@/lib/queries/vitals";
import { formatReading } from "@/app/(dashboard)/patient/vitals-history";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const FLAG_LABEL: Record<string, string> = {
  duplicate_entry: "Possible duplicate entry",
  sudden_change: "Unusual change from this patient's recent readings",
  insufficient_context: "Missing measurement details (position/arm)",
};

/**
 * §6.6 — readings the platform flagged rather than discarded (see
 * private.flag_vitals_requiring_validation). A clinician clears one once
 * they've looked at it via public.clear_vitals_validation_flag(), which
 * records who reviewed it and when. Renders nothing when there is nothing
 * to review, same restraint as the other conditional panels on this page.
 */
export function FlaggedReadingsPanel({ patientId }: { patientId: string }) {
  const { data, isLoading } = useFlaggedVitalsReadings(patientId);
  const queryClient = useQueryClient();
  const [clearingId, setClearingId] = useState<string | null>(null);

  if (isLoading || !data || data.length === 0) return null;

  async function clearFlag(readingId: string) {
    setClearingId(readingId);
    const supabase = createClient();
    const { error } = await supabase.rpc("clear_vitals_validation_flag", { p_reading_id: readingId });
    setClearingId(null);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ["flagged-vitals-readings", patientId] });
      queryClient.invalidateQueries({ queryKey: ["vitals-readings", patientId] });
    }
  }

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="text-base">Readings needing a second look</CardTitle>
        <p className="text-sm text-charcoal-ink/60">
          Flagged automatically — a real abnormal reading still reaches the record and its own
          alert, if any, fires as normal. This just asks for a human glance before relying on it.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {data.map((reading) => (
            <li key={reading.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{formatReading(reading)}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {new Date(reading.taken_at).toLocaleString()} ·{" "}
                  {reading.validation_flags.map((f) => FLAG_LABEL[f] ?? f).join(", ")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={clearingId === reading.id}
                onClick={() => clearFlag(reading.id)}
              >
                {clearingId === reading.id ? "Marking…" : "Mark reviewed"}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
