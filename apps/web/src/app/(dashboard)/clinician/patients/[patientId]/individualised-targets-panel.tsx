"use client";

import { useState } from "react";
import {
  useSpo2Target,
  useTemperatureTarget,
  usePulseTarget,
  useUpsertSpo2Target,
  useUpsertTemperatureTarget,
  useUpsertPulseTarget,
} from "@/lib/queries/vital-targets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * §6.10 — clinician-facing editor for the individualised SpO2/temperature/
 * pulse targets added alongside the red-flag triggers. Each override can
 * only ever adjust the ROUTINE review threshold (amber) — the red/
 * emergency safety floor is enforced by the tables' own CHECK constraints,
 * not by anything in this form, so a mistyped value here is rejected by
 * the database rather than silently accepted.
 */
export function IndividualisedTargetsPanel({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Individualised targets</CardTitle>
        <p className="text-sm text-charcoal-ink/60">
          Adjusts only the routine review threshold for this patient — the emergency safety bands are
          fixed and never change here.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Spo2TargetRow patientId={patientId} organisationId={organisationId} />
        <TemperatureTargetRow patientId={patientId} organisationId={organisationId} />
        <PulseTargetRow patientId={patientId} organisationId={organisationId} />
      </CardContent>
    </Card>
  );
}

function Spo2TargetRow({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const { data: target } = useSpo2Target(patientId);
  const upsert = useUpsertSpo2Target();
  const [value, setValue] = useState(String(target?.amber_threshold_pct ?? 94));
  const [rationale, setRationale] = useState(target?.rationale ?? "");

  return (
    <div className="grid grid-cols-1 gap-2 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label className="text-xs">SpO2 review threshold (93-100%)</Label>
        <Input type="number" min={93} max={100} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Rationale (optional)</Label>
        <Input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. closer monitoring for asthma" />
      </div>
      <Button
        type="button"
        size="sm"
        disabled={upsert.isPending}
        onClick={() =>
          upsert.mutate({
            patientId,
            organisationId,
            amberThresholdPct: Math.max(93, Math.min(100, Number(value) || 94)),
            rationale: rationale.trim() === "" ? null : rationale.trim(),
          })
        }
      >
        {upsert.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

function TemperatureTargetRow({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const { data: target } = useTemperatureTarget(patientId);
  const upsert = useUpsertTemperatureTarget();
  const [value, setValue] = useState(String(target?.amber_threshold_c ?? 38.0));
  const [rationale, setRationale] = useState(target?.rationale ?? "");

  return (
    <div className="grid grid-cols-1 gap-2 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label className="text-xs">Temperature review threshold (37.0-38.9°C)</Label>
        <Input
          type="number"
          step="0.1"
          min={37.0}
          max={38.9}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Rationale (optional)</Label>
        <Input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. immunocompromised, review low-grade fever sooner" />
      </div>
      <Button
        type="button"
        size="sm"
        disabled={upsert.isPending}
        onClick={() =>
          upsert.mutate({
            patientId,
            organisationId,
            amberThresholdC: Math.max(37.0, Math.min(38.9, Number(value) || 38.0)),
            rationale: rationale.trim() === "" ? null : rationale.trim(),
          })
        }
      >
        {upsert.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

function PulseTargetRow({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const { data: target } = usePulseTarget(patientId);
  const upsert = useUpsertPulseTarget();
  const [min, setMin] = useState(String(target?.resting_min_bpm ?? 60));
  const [max, setMax] = useState(String(target?.resting_max_bpm ?? 100));
  const [rationale, setRationale] = useState(target?.rationale ?? "");

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label className="text-xs">Resting pulse min (bpm)</Label>
        <Input type="number" min={30} max={149} value={min} onChange={(e) => setMin(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Resting pulse max (bpm)</Label>
        <Input type="number" min={31} max={150} value={max} onChange={(e) => setMax(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Rationale (optional)</Label>
        <Input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. rate-controlling medication" />
      </div>
      <Button
        type="button"
        size="sm"
        disabled={upsert.isPending}
        onClick={() => {
          const minVal = Math.max(30, Math.min(149, Number(min) || 60));
          const maxVal = Math.max(minVal + 1, Math.min(150, Number(max) || 100));
          upsert.mutate({
            patientId,
            organisationId,
            restingMinBpm: minVal,
            restingMaxBpm: maxVal,
            rationale: rationale.trim() === "" ? null : rationale.trim(),
          });
        }}
      >
        {upsert.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
