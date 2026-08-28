"use client";

import { useState } from "react";
import {
  useMonitoringSchedule,
  useUpdateMonitoringScheduleItem,
} from "@/lib/queries/monitoring-schedule";
import { TARGET_FIELDS, VITAL_TYPE_LABEL } from "@/lib/vitals/target-fields";
import type { Database, Json } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

type ScheduleItem = Database["public"]["Tables"]["monitoring_schedule_items"]["Row"];
type ItemStatus = Database["public"]["Enums"]["monitoring_item_status"];

function readTargetValue(target: Json | null, key: string): string {
  if (!target || typeof target !== "object" || Array.isArray(target)) return "";
  const value = (target as Record<string, Json>)[key];
  return typeof value === "number" ? String(value) : "";
}

function ScheduleItemRow({ item }: { item: ScheduleItem }) {
  const update = useUpdateMonitoringScheduleItem();
  const fields = TARGET_FIELDS[item.vital_type] ?? [];
  const [frequency, setFrequency] = useState(String(item.frequency_per_week));
  const [status, setStatus] = useState<ItemStatus>(item.status);
  const [instructions, setInstructions] = useState(item.patient_instructions ?? "");
  const [targetValues, setTargetValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, readTargetValue(item.target, f.key)]))
  );

  function handleSave() {
    const target: Record<string, number> = {};
    for (const f of fields) {
      const raw = targetValues[f.key];
      if (raw !== undefined && raw.trim() !== "") {
        const num = Number(raw);
        if (Number.isFinite(num)) target[f.key] = num;
      }
    }
    update.mutate({
      id: item.id,
      patientId: item.patient_id,
      frequency_per_week: Math.max(1, Math.min(21, Number(frequency) || item.frequency_per_week)),
      status,
      patient_instructions: instructions.trim() === "" ? null : instructions.trim(),
      target: Object.keys(target).length > 0 ? (target as unknown as Json) : null,
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-charcoal-ink">{VITAL_TYPE_LABEL[item.vital_type]}</p>
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ItemStatus)}
          className="w-32"
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Times per week</Label>
          <Input
            type="number"
            min={1}
            max={21}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          />
        </div>
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">
              Target {f.label} ({f.unit})
            </Label>
            <Input
              type="number"
              step="0.1"
              value={targetValues[f.key] ?? ""}
              onChange={(e) => setTargetValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder="—"
            />
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Patient instructions</Label>
        <Input
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Measure seated, after 5 minutes rest"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={update.isPending} onClick={handleSave}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
        {update.isSuccess && <span className="text-xs text-brand-green">Saved.</span>}
        {update.isError && <span className="text-xs text-red-600">Could not save — try again.</span>}
      </div>
    </div>
  );
}

/**
 * §6.3/§6.4 — editing a monitoring_schedule_items row after it's auto-
 * seeded from a chronic programme enrolment. Only frequency/status/target/
 * patient_instructions are editable here; acceptable_range and
 * escalation_threshold stay clinician-set via direct DB access for now
 * (RLS already supports it) — a dedicated editor for those is future work,
 * not attempted here to keep this scoped to what a clinician actually asks
 * for day to day: "how often" and "what's the target".
 */
export function MonitoringSchedulePanel({ patientId }: { patientId: string }) {
  const { data, isLoading } = useMonitoringSchedule(patientId);

  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monitoring schedule</CardTitle>
        <p className="text-sm text-charcoal-ink/60">
          How often this patient is asked to log each vital, and their individual targets.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((item) => (
          <ScheduleItemRow key={item.id} item={item} />
        ))}
      </CardContent>
    </Card>
  );
}
