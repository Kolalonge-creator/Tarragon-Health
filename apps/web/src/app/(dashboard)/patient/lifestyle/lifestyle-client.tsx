"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  enrollAction,
  logReadingAction,
  resolveGoalAction,
  submitObesityEdScreenAndEnrollAction,
  type LifestyleActionState,
} from "./actions";
import type { LifestyleEnrollmentView, PastLifestyleGoalView } from "@/lib/lifestyle/service";
import {
  ED_DISORDERED_BEHAVIOURS,
  ED_DISORDERED_BEHAVIOUR_LABELS,
} from "@/lib/validation/obesity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { GoalsDialog } from "./goals-dialog";
import { AiCoachChat } from "@/app/(dashboard)/patient/ai-coach-chat";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { useWeightGoal } from "@/lib/queries/weight-goal";
import { useLatestWeightKg } from "@/lib/queries/vitals";
import { useActivityGoal, useTodaySteps } from "@/lib/queries/activity";
import { useWellnessPointsBalance } from "@/lib/queries/wellness";
import { obesityLabelTitleCase } from "@/lib/copy/condition-language";

const TRACKERS = [
  {
    href: "/patient/nutrition",
    label: "Meals",
    description: "Log what you eat, with a photo if you like",
    icon: SEMANTIC_ICON.aiCoach,
  },
  {
    href: "/patient/weight",
    label: "Weight",
    description: "Track progress against a goal you set",
    icon: SEMANTIC_ICON.weight,
  },
  {
    href: "/patient/activity",
    label: "Activity",
    description: "Log steps and workouts",
    icon: SEMANTIC_ICON.steps,
  },
  {
    href: "/patient/wellness",
    label: "Rewards",
    description: "Points, badges, and challenges",
    icon: NAV_ICON.wellness,
  },
] as const;

/**
 * Single "where am I today" panel so a patient doesn't have to visit four
 * separate pages to see their own state — weight, steps, and points are
 * pulled inline here; each tile still links out to its own page to log or
 * edit. Nothing here is a new source of truth: every number is read from the
 * same tables/hooks their own dedicated pages already use.
 */
function AtAGlancePanel({ patientId }: { patientId: string }) {
  const { data: weightGoal } = useWeightGoal(patientId);
  const { data: latestWeight } = useLatestWeightKg(patientId);
  const { data: activityGoal } = useActivityGoal(patientId);
  const { data: todaySteps } = useTodaySteps(patientId);
  const { data: pointsBalance } = useWellnessPointsBalance(patientId);

  const weightLine = (() => {
    if (!latestWeight?.weight_kg) return "Log a weight to start tracking";
    const current = latestWeight.weight_kg;
    if (!weightGoal?.goal_weight_kg) return `${current} kg logged`;
    const remaining = current - weightGoal.goal_weight_kg;
    if (Math.abs(remaining) < 0.1) return `${current} kg, at your goal`;
    return remaining > 0
      ? `${current} kg, ${remaining.toFixed(1)} kg to your ${weightGoal.goal_weight_kg} kg goal`
      : `${current} kg, ${Math.abs(remaining).toFixed(1)} kg past your ${weightGoal.goal_weight_kg} kg goal`;
  })();

  const stepGoal = activityGoal?.daily_step_goal ?? 7500;
  const steps = todaySteps ?? 0;
  const stepsLine = `${steps.toLocaleString()} of ${stepGoal.toLocaleString()} steps today`;

  const points = pointsBalance?.balance ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Where you are today</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-charcoal-ink/10 p-3">
            <div className="flex items-center gap-2 text-charcoal-ink/60">
              <SEMANTIC_ICON.weight className="h-4 w-4" strokeWidth={2} />
              <span className="text-xs">Weight</span>
            </div>
            <p className="mt-1 text-sm font-medium text-charcoal-ink">{weightLine}</p>
          </div>
          <div className="rounded-lg border border-charcoal-ink/10 p-3">
            <div className="flex items-center gap-2 text-charcoal-ink/60">
              <SEMANTIC_ICON.steps className="h-4 w-4" strokeWidth={2} />
              <span className="text-xs">Activity</span>
            </div>
            <p className="mt-1 text-sm font-medium text-charcoal-ink">{stepsLine}</p>
          </div>
          <div className="rounded-lg border border-charcoal-ink/10 p-3">
            <div className="flex items-center gap-2 text-charcoal-ink/60">
              <NAV_ICON.wellness className="h-4 w-4" strokeWidth={2} />
              <span className="text-xs">Rewards</span>
            </div>
            <p className="mt-1 text-sm font-medium text-charcoal-ink">
              {points.toLocaleString()} points banked
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {TRACKERS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col gap-2 rounded-lg border border-charcoal-ink/10 p-4 transition-colors hover:border-brand-green hover:bg-soft-sage"
            >
              <Icon className="h-5 w-5 text-deep-forest" strokeWidth={2} />
              <span className="text-sm font-medium text-charcoal-ink">{label}</span>
              <span className="text-xs text-charcoal-ink/60">{description}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function enrollableFor(
  preference: string | null | undefined,
): { key: "obesity" | "htn" | "diabetes"; label: string }[] {
  return [
    { key: "obesity", label: `${obesityLabelTitleCase(preference)} & lifestyle` },
    { key: "htn", label: "Blood pressure" },
    { key: "diabetes", label: "Diabetes" },
  ];
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "paused" ? "amber" : status === "active" ? "green" : "grey";
  return <Badge variant={tone}>{status}</Badge>;
}

export function LifestyleClient({
  patientId,
  enrollments,
  pastGoals,
  conditionLanguagePreference,
  coachAccess,
}: {
  patientId: string;
  enrollments: LifestyleEnrollmentView[];
  pastGoals: PastLifestyleGoalView[];
  conditionLanguagePreference?: string | null;
  coachAccess: boolean;
}) {
  const [enrollState, enroll] = useActionState<LifestyleActionState, FormData>(
    enrollAction,
    undefined,
  );
  const [consented, setConsented] = useState(false);
  const enrolledConditions = new Set(enrollments.map((e) => e.conditionKey));
  const available = enrollableFor(conditionLanguagePreference).filter(
    (c) => !enrolledConditions.has(c.key),
  );
  // Once the screen+enrol action succeeds, `enrollments` (server props) will
  // include obesity on the next render — drop back to the normal buttons
  // instead of leaving the screen form stuck showing after success.
  const showEdScreenGate = enrollState?.needsEdScreen && !enrolledConditions.has("obesity");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lifestyle coaching"
        icon={NAV_ICON.lifestyle}
        description="Small, steady changes, logged here, supported by your care team."
        actions={<GoalsDialog enrollments={enrollments} pastGoals={pastGoals} />}
      />

      <AtAGlancePanel patientId={patientId} />

      {enrollments.map((e) => (
        <Card key={e.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">
              {e.programmeName ?? e.condition}
            </CardTitle>
            <StatusBadge status={e.status} />
          </CardHeader>
          <CardContent className="space-y-4">
            {e.status === "paused" ? (
              <p className="text-sm text-muted-foreground">
                This programme is paused while your care team checks in with you.
                We&apos;re here to support you.
              </p>
            ) : (
              <>
                {e.currentPhaseName && (
                  <p className="text-sm">
                    Current phase:{" "}
                    <span className="font-medium">{e.currentPhaseName}</span>
                  </p>
                )}
                {e.goals.length > 0 && (
                  <ul className="space-y-2 text-sm">
                    {e.goals.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="text-muted-foreground capitalize">{g.module}</span>{" "}
                          {g.title}
                        </span>
                        {g.personalised && <ResolveGoalControls goalId={g.id} />}
                      </li>
                    ))}
                  </ul>
                )}
                {e.nextReviewDue && (
                  <p className="text-muted-foreground text-xs">
                    Next care-team review:{" "}
                    {new Date(e.nextReviewDue).toLocaleDateString()}
                  </p>
                )}
                {e.conditionKey && (
                  <LogForm enrollmentId={e.id} conditionKey={e.conditionKey} />
                )}
              </>
            )}
          </CardContent>
        </Card>
      ))}

      {coachAccess && <AiCoachChat patientId={patientId} />}

      {available.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Start a programme</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {enrollState?.message && (
              <p className="text-sm text-brand-green">{enrollState.message}</p>
            )}
            {enrollState?.error && (
              <p className="text-sm text-destructive">{enrollState.error}</p>
            )}

            {showEdScreenGate ? (
              <ObesityEdScreenGateForm consented={consented} />
            ) : (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={consented}
                    onChange={(e) => setConsented(e.target.checked)}
                  />
                  <span className="text-muted-foreground">
                    I agree that my logged readings and check-ins can be reviewed by
                    my Tarragon care team to support this programme, and I can
                    withdraw at any time.
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {available.map((c) => (
                    <form key={c.key} action={enroll}>
                      <input type="hidden" name="conditionKey" value={c.key} />
                      <input
                        type="hidden"
                        name="consent"
                        value={consented ? "on" : "off"}
                      />
                      <Button type="submit" variant="outline" disabled={!consented}>
                        {c.label}
                      </Button>
                    </form>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const SCOFF_ITEMS: { name: string; label: string }[] = [
  { name: "scoff_sick", label: "Do you make yourself sick because you feel uncomfortably full?" },
  { name: "scoff_control", label: "Do you worry you have lost control over how much you eat?" },
  { name: "scoff_one_stone", label: "Have you recently lost more than 6 kg in the last 3 months?" },
  { name: "scoff_fat", label: "Do you believe yourself to be fat when others say you are too thin?" },
  { name: "scoff_food_dominates", label: "Would you say that food dominates your life?" },
];

/**
 * The mandatory ED/mental-health screen (§6.5, §16, §18), shown in place of
 * the enrol buttons whenever `enrollAction` reports no screen is on file yet
 * for this patient — the pathway's own rule is that no weight-loss plan
 * starts before this exists. Submitting it enrols the patient in the same
 * step (`submitObesityEdScreenAndEnrollAction`); a positive answer never
 * blocks support, it just starts the programme paused for a doctor to check
 * in first, which the "paused" card above already explains kindly.
 */
function ObesityEdScreenGateForm({ consented }: { consented: boolean }) {
  const [state, submit] = useActionState<LifestyleActionState, FormData>(
    submitObesityEdScreenAndEnrollAction,
    undefined,
  );

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="consent" value={consented ? "on" : "off"} />
      <p className="text-sm text-muted-foreground">
        Before we start on weight or eating goals, a few quick questions: this
        is just so your care team can support you well from day one.
      </p>

      <fieldset className="space-y-2">
        {SCOFF_ITEMS.map((item) => (
          <label key={item.name} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name={item.name} className="mt-1" />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-charcoal-ink">
          Any of these lately?
        </legend>
        {ED_DISORDERED_BEHAVIOURS.map((code) => (
          <label key={code} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="disordered_behaviours" value={code} className="mt-1" />
            <span>{ED_DISORDERED_BEHAVIOUR_LABELS[code]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="low_mood" className="mt-1" />
          <span>Feeling low, hopeless, or more anxious than usual lately</span>
        </label>
        <label className="flex items-start gap-2 text-sm font-medium">
          <input type="checkbox" name="self_harm_risk" className="mt-1" />
          <span>Any thoughts of harming yourself</span>
        </label>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="ed_notes">Anything else you&apos;d like your care team to know?</Label>
        <Textarea id="ed_notes" name="notes" rows={2} />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={!consented}>
        Continue
      </Button>
    </form>
  );
}

function LogForm({
  enrollmentId,
  conditionKey,
}: {
  enrollmentId: string;
  conditionKey: "obesity" | "htn" | "diabetes";
}) {
  const [state, log] = useActionState<LifestyleActionState, FormData>(
    logReadingAction,
    undefined,
  );
  return (
    <form action={log} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="conditionKey" value={conditionKey} />
      <p className="text-sm font-medium">Quick check-in</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`type-${enrollmentId}`}>What are you logging?</Label>
          <select
            id={`type-${enrollmentId}`}
            name="type"
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            defaultValue="mood"
          >
            <option value="mood">How I&apos;m feeling</option>
            <option value="weight">Weight (kg)</option>
            <option value="activity_minutes">Active minutes</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`value-${enrollmentId}`}>Value</Label>
          <Input
            id={`value-${enrollmentId}`}
            name="value"
            type="number"
            step="any"
            placeholder="e.g. 3"
          />
        </div>
      </div>

      {conditionKey === "obesity" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="strugglingWithFood" />
          I&apos;ve been struggling with food or eating lately
        </label>
      )}

      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="sm">
        Log check-in
      </Button>
    </form>
  );
}

function ResolveGoalControls({ goalId }: { goalId: string }) {
  const [state, resolve] = useActionState<LifestyleActionState, FormData>(
    resolveGoalAction,
    undefined,
  );

  if (state?.success) {
    return <span className="text-xs text-brand-green">{state.message}</span>;
  }

  return (
    <span className="flex shrink-0 gap-2">
      <form action={resolve}>
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="status" value="achieved" />
        <button type="submit" className="text-xs text-brand-green hover:underline">
          Mark achieved
        </button>
      </form>
      <form action={resolve}>
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="status" value="abandoned" />
        <button type="submit" className="text-xs text-muted-foreground hover:underline">
          Let this go
        </button>
      </form>
    </span>
  );
}
