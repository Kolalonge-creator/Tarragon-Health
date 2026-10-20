"use client";

import { useActionState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { en } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { formatPatientDateTime } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { correctInhalerUse, type ObservationActionState } from "./observation-actions";

/**
 * S47a (BUILD-SPEC-v5 4.2, 4.7): the person's recent inhaler uses, each with the "Changed" marker when she corrected it, and a control to change
 * one. Reads the current-entry view of her own log (the original of a changed entry stays in the database as history). Shown only while the
 * `extended_observations` module is on (the parent page checks). No advice or rule is attached to the numbers (OQ-S47A-2).
 */
const REASONS = ["breathless_or_wheeze", "before_exercise", "routine_dose", "night_symptoms", "other"] as const;
type Row = { id: string; puffs: number; reason: string; taken_at: string; was_changed: boolean };

function EditRow({ row }: { row: Row }) {
  const [state, action, pending] = useActionState<ObservationActionState, FormData>(correctInhalerUse, undefined);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (state?.success) void queryClient.invalidateQueries({ queryKey: ["inhaler-use-current"] });
  }, [state, queryClient]);
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-deep-forest underline dark:text-brand-green-bright">Change this entry</summary>
      <form action={action} className="mt-2 space-y-2" noValidate>
        <input type="hidden" name="id" value={row.id} />
        <div className="space-y-1">
          <Label htmlFor={`inh_puffs_${row.id}`}>{en["observation.inhaler.puffs_label"]}</Label>
          <Input id={`inh_puffs_${row.id}`} name="puffs" type="number" inputMode="numeric" step="1" defaultValue={row.puffs} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`inh_reason_${row.id}`}>{en["observation.inhaler.reason_group"]}</Label>
          <Select id={`inh_reason_${row.id}`} name="reason" defaultValue={row.reason} required>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {en[`observation.inhaler.reason.${r}` as const]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`inh_why_${row.id}`}>What was wrong?</Label>
          <Input id={`inh_why_${row.id}`} name="why" type="text" minLength={5} maxLength={300} required />
        </div>
        <p className="text-charcoal-ink/60 dark:text-night-ink/60">The first entry is kept in your history, and this list shows the new one with a Changed marker.</p>
        <FormError id={`inh-error-${row.id}`} message={state?.error} />
        {state?.success ? <p role="status">Changed. Thank you.</p> : null}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save the change"}
        </Button>
      </form>
    </details>
  );
}

export function InhalerHistory({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["inhaler-use-current", patientId],
    queryFn: async (): Promise<Row[]> => {
      const { data: rows, error } = await createClient()
        .from("inhaler_use_current")
        .select("id, puffs, reason, taken_at, was_changed")
        .eq("patient_id", patientId)
        .order("taken_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (rows ?? []).flatMap((r) =>
        r.id && r.puffs !== null && r.reason && r.taken_at ? [{ id: r.id, puffs: r.puffs, reason: r.reason, taken_at: r.taken_at, was_changed: r.was_changed === true }] : []
      );
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!patientId,
  });

  if (isLoading) return null;
  if (isError) return <p className="text-sm text-red-600 dark:text-red-300">Could not load your inhaler log.</p>;
  if (!data || data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent inhaler use</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {data.map((row) => (
            <li key={row.id} className="py-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                  {row.puffs} {row.puffs === 1 ? "puff" : "puffs"}, {en[`observation.inhaler.reason.${row.reason}` as keyof typeof en] ?? row.reason}
                  {row.was_changed ? (
                    <span
                      className="ml-2 inline-block rounded-full border border-charcoal-ink/30 px-2 py-0.5 text-[11px] font-medium dark:border-night-ink/40"
                      title={en["observation.changed.a11y"]}
                      aria-label={en["observation.changed.a11y"]}
                    >
                      {en["observation.changed.marker"]}
                    </span>
                  ) : null}
                </p>
                <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{formatPatientDateTime(row.taken_at)}</span>
              </div>
              <EditRow row={row} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
