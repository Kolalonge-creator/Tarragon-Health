"use client";

import { useCgmConnections, useActiveCgmPartners, useCgmReadings } from "@/lib/queries/cgm";
import { computeTimeInRange } from "@/lib/cgm/time-in-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Continuous glucose monitoring card. DORMANT by design: it renders nothing
 * until either the patient has a CGM connection or an active CGM partner exists
 * (both impossible until ops onboards a real partner). With an active
 * connection it shows a display-only time-in-range summary — never a clinical
 * judgement, never an escalation.
 */
export function CgmCard({ patientId }: { patientId: string }) {
  const { data: connections } = useCgmConnections(patientId);
  const { data: partners } = useActiveCgmPartners();
  const { data: readings } = useCgmReadings(patientId);

  const activeConnection = (connections ?? []).find((c) => c.status === "active");
  const hasActivePartner = (partners ?? []).length > 0;

  // Fully dormant — show nothing.
  if (!activeConnection && !hasActivePartner) return null;

  // A partner is live but this patient isn't connected yet.
  if (!activeConnection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Continuous glucose monitoring</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/70">
            Continuous glucose monitoring is now available. Ask your care team to connect your
            monitor so your readings appear here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tir = computeTimeInRange(readings ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Continuous glucose monitoring</CardTitle>
      </CardHeader>
      <CardContent>
        {tir.count === 0 ? (
          <p className="text-sm text-charcoal-ink/70">
            Your monitor is connected. Readings will appear here once they sync.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/70">
              Last 14 days · {tir.count} readings
            </p>
            <div className="flex overflow-hidden rounded-md" aria-hidden>
              <div className="h-3 bg-red-400" style={{ width: `${tir.lowPct}%` }} />
              <div className="h-3 bg-green-500" style={{ width: `${tir.inRangePct}%` }} />
              <div className="h-3 bg-amber-400" style={{ width: `${tir.highPct}%` }} />
            </div>
            <ul className="flex flex-wrap gap-4 text-sm">
              <li>
                <span className="font-medium text-green-700">{tir.inRangePct}%</span> in range
              </li>
              <li>
                <span className="font-medium text-red-600">{tir.lowPct}%</span> low
              </li>
              <li>
                <span className="font-medium text-amber-600">{tir.highPct}%</span> high
              </li>
            </ul>
            <p className="text-xs text-charcoal-ink/50">
              A coaching summary of your time in range (3.9–10.0 mmol/L) — not a medical assessment.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
