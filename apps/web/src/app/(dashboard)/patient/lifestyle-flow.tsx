"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  saveLifestyleAssessment,
  createLifestyleGoal,
  enrolLifestyleProgramme,
} from "./lifestyle-actions";
import {
  useLatestLifestyleAssessment,
  useLifestyleGoals,
  useUpdateGoalStatus,
  useActiveLifestyleProgrammes,
  useMyLifestyleEnrolments,
  usePatientDueLifestyleCheckins,
  useRespondToLifestyleCheckin,
  usePatientNextLifestyleReview,
  type LifestyleGoal,
  type LifestyleCheckin,
} from "@/lib/queries/lifestyle";
import { useVitalsTrend } from "@/lib/queries/vitals";
import {
  LIFESTYLE_DOMAINS,
  LIFESTYLE_DOMAIN_LABELS,
} from "@/lib/validation/lifestyle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// --- 1. Assessment ---------------------------------------------------------
function AssessmentSection({ patientId }: { patientId: string }) {
  const { data: latest } = useLatestLifestyleAssessment(patientId);
  const [state, formAction, pending] = useActionState(saveLifestyleAssessment, undefined);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["lifestyle-assessment", patientId] });
      queryClient.invalidateQueries({ queryKey: ["lifestyle-reviews", "next", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your lifestyle baseline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {latest ? (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat label="Activity / week" value={fmt(latest.activity_minutes_weekly, "min")} />
            <Stat label="Sleep / night" value={fmt(latest.sleep_hours_nightly, "hrs")} />
            <Stat label="Stress (1–5)" value={fmt(latest.stress_level)} />
            <Stat label="Diet (1–5)" value={fmt(latest.diet_quality)} />
            <Stat label="Alcohol / week" value={fmt(latest.alcohol_units_weekly, "units")} />
            <Stat label="Updated" value={lagosDate(latest.created_at)} />
          </div>
        ) : (
          <p className="text-sm text-charcoal-ink/70">
            Take a quick baseline so your care team can tailor your coaching. It&apos;s optional and
            you can update it any time.
          </p>
        )}

        {open ? (
          <form action={formAction} className="grid gap-3 sm:grid-cols-2">
            <Field name="activity_minutes_weekly" label="Active minutes per week" type="number" min={0} defaultValue={latest?.activity_minutes_weekly} />
            <Field name="sleep_hours_nightly" label="Sleep hours per night" type="number" min={0} max={24} step="0.5" defaultValue={latest?.sleep_hours_nightly} />
            <div className="space-y-1.5">
              <Label htmlFor="stress_level">Stress level</Label>
              <Select id="stress_level" name="stress_level" defaultValue={latest?.stress_level?.toString() ?? ""}>
                <option value="">Prefer not to say</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? "(low)" : n === 5 ? "(high)" : ""}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="diet_quality">Diet quality</Label>
              <Select id="diet_quality" name="diet_quality" defaultValue={latest?.diet_quality?.toString() ?? ""}>
                <option value="">Prefer not to say</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? "(poor)" : n === 5 ? "(great)" : ""}</option>
                ))}
              </Select>
            </div>
            <Field name="alcohol_units_weekly" label="Alcohol units per week" type="number" min={0} defaultValue={latest?.alcohol_units_weekly} />
            <div className="space-y-1.5">
              <Label htmlFor="smokes">Do you smoke?</Label>
              <Select id="smokes" name="smokes" defaultValue={latest?.smokes == null ? "" : String(latest.smokes)}>
                <option value="">Prefer not to say</option>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Anything else (optional)</Label>
              <Textarea id="notes" name="notes" rows={2} defaultValue={latest?.notes ?? ""} />
            </div>
            {state?.error && <p className="text-xs text-red-600 sm:col-span-2">{state.error}</p>}
            {state?.success && <p className="text-xs text-deep-forest sm:col-span-2">Saved ✓</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save baseline"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {latest ? "Update baseline" : "Take baseline"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// --- 2. Goals --------------------------------------------------------------
function GoalRow({ goal, patientId }: { goal: LifestyleGoal; patientId: string }) {
  const update = useUpdateGoalStatus(patientId);
  const done = goal.status === "achieved";
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div>
        <p className="text-sm text-charcoal-ink">
          <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-xs font-medium text-deep-forest">
            {LIFESTYLE_DOMAIN_LABELS[goal.domain]}
          </span>{" "}
          <span className={done ? "line-through opacity-60" : ""}>{goal.title}</span>
        </p>
        {goal.target_date && (
          <p className="text-xs text-charcoal-ink/60">Target by {lagosDate(goal.target_date)}</p>
        )}
      </div>
      {goal.status === "active" && (
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" disabled={update.isPending}
            onClick={() => update.mutate({ goalId: goal.id, status: "achieved" })}>
            Done
          </Button>
          <Button size="sm" variant="ghost" disabled={update.isPending}
            onClick={() => update.mutate({ goalId: goal.id, status: "abandoned" })}>
            Drop
          </Button>
        </div>
      )}
    </li>
  );
}

function GoalsSection({ patientId }: { patientId: string }) {
  const { data: goals } = useLifestyleGoals(patientId);
  const [state, formAction, pending] = useActionState(createLifestyleGoal, undefined);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["lifestyle-goals", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  const active = goals?.filter((g) => g.status !== "abandoned") ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your goals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length > 0 ? (
          <ul className="divide-y divide-charcoal-ink/10">
            {active.map((goal) => (
              <GoalRow key={goal.id} goal={goal} patientId={patientId} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-charcoal-ink/70">
            Set a small, specific goal for your diet, activity, weight, sleep or stress.
          </p>
        )}

        {open ? (
          <form action={formAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="domain">Area</Label>
              <Select id="domain" name="domain" defaultValue="diet" required>
                {LIFESTYLE_DOMAINS.map((d) => (
                  <option key={d} value={d}>{LIFESTYLE_DOMAIN_LABELS[d]}</option>
                ))}
              </Select>
            </div>
            <Field name="target_date" label="Target date (optional)" type="date" />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="title">Goal</Label>
              <Input id="title" name="title" placeholder="e.g. Walk 20 minutes after dinner" required />
            </div>
            {state?.error && <p className="text-xs text-red-600 sm:col-span-2">{state.error}</p>}
            {state?.success && <p className="text-xs text-deep-forest sm:col-span-2">Goal added ✓</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Adding…" : "Add goal"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Add a goal</Button>
        )}
      </CardContent>
    </Card>
  );
}

// --- 3. Programmes ---------------------------------------------------------
function ProgrammesSection({ patientId }: { patientId: string }) {
  const { data: programmes } = useActiveLifestyleProgrammes();
  const { data: enrolments } = useMyLifestyleEnrolments(patientId);
  const [state, formAction, pending] = useActionState(enrolLifestyleProgramme, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["lifestyle-enrolments", patientId] });
      queryClient.invalidateQueries({ queryKey: ["lifestyle-checkins", patientId] });
      queryClient.invalidateQueries({ queryKey: ["lifestyle-reviews", "next", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  const enrolledIds = new Set(enrolments?.map((e) => e.programme_id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diet &amp; exercise programmes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        <ul className="space-y-3">
          {(programmes ?? []).map((prog) => {
            const enrolled = enrolledIds.has(prog.id);
            return (
              <li key={prog.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-xs font-medium text-deep-forest">
                        {prog.domain === "diet" ? "Diet" : "Exercise"}
                      </span>{" "}
                      {prog.name}
                    </p>
                    {prog.description && (
                      <p className="mt-1 text-xs text-charcoal-ink/70">{prog.description}</p>
                    )}
                  </div>
                  {enrolled ? (
                    <span className="shrink-0 text-xs font-medium text-deep-forest">Enrolled ✓</span>
                  ) : (
                    <form action={formAction} className="shrink-0">
                      <input type="hidden" name="programme_id" value={prog.id} />
                      <Button type="submit" size="sm" variant="outline" disabled={pending}>
                        Enrol
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// --- 4. Weight -------------------------------------------------------------
export function WeightProgressSection({ patientId }: { patientId: string }) {
  const { data } = useVitalsTrend(patientId, "weight");
  const points = (data ?? []).filter((r) => r.weight_kg != null);

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Weight</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/70">
            Log your weight from the dashboard to track progress here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const baseline = points[0]!.weight_kg!;
  const latest = points[points.length - 1]!.weight_kg!;
  const delta = latest - baseline;
  const pct = baseline > 0 ? (delta / baseline) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weight</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Baseline (90d)" value={`${baseline.toFixed(1)} kg`} />
          <Stat label="Latest" value={`${latest.toFixed(1)} kg`} />
          <Stat
            label="Change"
            value={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)} kg (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// --- 5. Check-ins ----------------------------------------------------------
function CheckinRow({ checkin, patientId }: { checkin: LifestyleCheckin; patientId: string }) {
  const respond = useRespondToLifestyleCheckin(patientId);
  const [answer, setAnswer] = useState("");
  return (
    <li className="space-y-2 py-3">
      <p className="text-sm text-charcoal-ink">{checkin.title} — how&apos;s it going?</p>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your update"
          className="h-9 min-w-48 flex-1 text-sm"
        />
        <Button size="sm" variant="outline" disabled={respond.isPending || !answer.trim()}
          onClick={() => respond.mutate({ checkinId: checkin.id, response: answer.trim() })}>
          {respond.isPending ? "Sending…" : "Send"}
        </Button>
      </div>
    </li>
  );
}

function CheckinsSection({ patientId }: { patientId: string }) {
  const { data } = usePatientDueLifestyleCheckins(patientId);
  if (!data || data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Coaching check-in</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {data.map((c) => (
            <CheckinRow key={c.id} checkin={c} patientId={patientId} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// --- 6. Progress review ----------------------------------------------------
function ReviewSection({ patientId }: { patientId: string }) {
  const { data: review } = usePatientNextLifestyleReview(patientId);
  if (!review) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next progress review</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-charcoal-ink/80">
          Your care team will review your progress around{" "}
          <span className="font-medium text-charcoal-ink">{lagosDate(review.due_date)}</span>.
        </p>
      </CardContent>
    </Card>
  );
}

// --- helpers ---------------------------------------------------------------
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-charcoal-ink/60">{label}</p>
      <p className="font-medium text-charcoal-ink">{value}</p>
    </div>
  );
}

function fmt(v: number | null, unit?: string): string {
  if (v == null) return "—";
  return unit ? `${v} ${unit}` : String(v);
}

function Field({
  name,
  label,
  type,
  min,
  max,
  step,
  defaultValue,
}: {
  name: string;
  label: string;
  type: string;
  min?: number;
  max?: number;
  step?: string;
  defaultValue?: number | null;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultValue ?? undefined}
      />
    </div>
  );
}

export function LifestyleFlow({ patientId }: { patientId: string }) {
  return (
    <div className="space-y-6">
      <AssessmentSection patientId={patientId} />
      <GoalsSection patientId={patientId} />
      <ProgrammesSection patientId={patientId} />
      <WeightProgressSection patientId={patientId} />
      <CheckinsSection patientId={patientId} />
      <ReviewSection patientId={patientId} />
    </div>
  );
}
