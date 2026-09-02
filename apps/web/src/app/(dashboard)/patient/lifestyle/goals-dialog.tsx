"use client";

import { useActionState, useEffect, useState } from "react";
import { createGoalAction, type LifestyleActionState } from "./actions";
import type { LifestyleEnrollmentView, PastLifestyleGoalView } from "@/lib/lifestyle/service";
import type { ConditionKey } from "@tarragon/lifestyle-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { APP_ICON } from "@/lib/icons";

type GoalModule = "diet" | "activity" | "behaviour" | "sleep" | "stress" | "smoking";

type Tile =
  | {
      kind: "module";
      module: GoalModule;
      label: string;
      icon: keyof typeof APP_ICON;
      placeholder: string;
      enrollmentId: string;
      tint: string;
    }
  | {
      kind: "condition";
      label: string;
      icon: keyof typeof APP_ICON;
      placeholder: string;
      enrollmentId: string;
      tint: string;
    };

function buildTiles(enrollments: LifestyleEnrollmentView[]): Tile[] {
  const active = enrollments.filter((e) => e.status === "active");
  const primary = active[0];
  const tiles: Tile[] = [];

  if (primary) {
    tiles.push(
      {
        kind: "module",
        module: "diet",
        label: "Food & drinks",
        icon: "food",
        placeholder: "e.g. Drink more water",
        enrollmentId: primary.id,
        tint: "bg-emerald-50",
      },
      {
        kind: "module",
        module: "activity",
        label: "Activity",
        icon: "lifestyle",
        placeholder: "e.g. Walk for 20 minutes",
        enrollmentId: primary.id,
        tint: "bg-orange-50",
      },
      {
        kind: "module",
        module: "sleep",
        label: "Sleep",
        icon: "sleep",
        placeholder: "e.g. Get to bed by 10pm",
        enrollmentId: primary.id,
        tint: "bg-sky-50",
      },
      {
        kind: "module",
        module: "behaviour",
        label: "Mood & mindset",
        icon: "mood",
        placeholder: "e.g. Try one mindful moment a day",
        enrollmentId: primary.id,
        tint: "bg-amber-50",
      },
      {
        kind: "module",
        module: "smoking",
        label: "Stop smoking",
        icon: "warning",
        placeholder: "e.g. Smoke-free by the end of the month",
        enrollmentId: primary.id,
        tint: "bg-rose-50",
      },
    );
  }

  const findActive = (key: ConditionKey) => active.find((e) => e.conditionKey === key);
  const htn = findActive("htn");
  if (htn) {
    tiles.push({
      kind: "condition",
      label: "Blood pressure care",
      icon: "bp",
      placeholder: "e.g. Cut back on added salt",
      enrollmentId: htn.id,
      tint: "bg-stone-50",
    });
  }
  const diabetes = findActive("diabetes");
  if (diabetes) {
    tiles.push({
      kind: "condition",
      label: "Diabetes care",
      icon: "diabetes",
      placeholder: "e.g. Check my blood sugar after meals",
      enrollmentId: diabetes.id,
      tint: "bg-cyan-50",
    });
  }

  return tiles;
}

export function GoalsDialog({
  enrollments,
  pastGoals,
}: {
  enrollments: LifestyleEnrollmentView[];
  pastGoals: PastLifestyleGoalView[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "past">("new");
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);

  const tiles = buildTiles(enrollments);
  if (tiles.length === 0) return null;

  function close() {
    setOpen(false);
    setTab("new");
    setSelectedTile(null);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Goals
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="goals-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-ink/60 p-4"
          onClick={close}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between rounded-t-2xl bg-brand-green px-6 py-5 text-white">
              <h2 id="goals-dialog-title" className="font-heading text-xl font-semibold">
                Goals
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="rounded-full p-1 text-white/90 hover:bg-white/10 hover:text-white"
              >
                <APP_ICON.close className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 border-b border-charcoal-ink/10 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setTab("new");
                  setSelectedTile(null);
                }}
                className={
                  tab === "new"
                    ? "rounded-full bg-brand-green px-4 py-1.5 text-sm font-medium text-white"
                    : "rounded-full px-4 py-1.5 text-sm font-medium text-charcoal-ink/60 hover:text-charcoal-ink"
                }
              >
                Set a new goal
              </button>
              <button
                type="button"
                onClick={() => setTab("past")}
                className={
                  tab === "past"
                    ? "px-2 text-sm font-medium text-brand-green underline underline-offset-4"
                    : "px-2 text-sm font-medium text-charcoal-ink/60 hover:text-charcoal-ink"
                }
              >
                View past goals
              </button>
            </div>

            <div className="p-6">
              {tab === "new" ? (
                selectedTile ? (
                  <GoalForm tile={selectedTile} onDone={close} onBack={() => setSelectedTile(null)} />
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-charcoal-ink">
                      What would you like to do next?
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {tiles.map((tile) => {
                        const Icon = APP_ICON[tile.icon];
                        return (
                          <button
                            key={tile.label}
                            type="button"
                            onClick={() => setSelectedTile(tile)}
                            className={`${tile.tint} flex flex-col gap-3 rounded-xl p-4 text-left transition hover:brightness-95`}
                          >
                            <Icon className="h-6 w-6 text-charcoal-ink/70" />
                            <span className="text-sm font-medium text-charcoal-ink">
                              {tile.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              ) : (
                <PastGoalsList goals={pastGoals} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function GoalForm({
  tile,
  onDone,
  onBack,
}: {
  tile: Tile;
  onDone: () => void;
  onBack: () => void;
}) {
  const [state, submit] = useActionState<LifestyleActionState, FormData>(
    createGoalAction,
    undefined,
  );
  const [module, setModule] = useState<GoalModule>(tile.kind === "module" ? tile.module : "diet");

  useEffect(() => {
    if (state?.success) {
      const t = setTimeout(onDone, 900);
      return () => clearTimeout(t);
    }
  }, [state, onDone]);

  if (state?.success) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm font-medium text-brand-green">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-charcoal-ink/60 hover:text-charcoal-ink"
      >
        <APP_ICON.chevronRight className="h-4 w-4 rotate-180" />
        Back
      </button>

      <input type="hidden" name="enrollmentId" value={tile.enrollmentId} />
      <input type="hidden" name="module" value={tile.kind === "module" ? tile.module : module} />

      <div className="flex items-center gap-2">
        <span className={`${tile.tint} rounded-lg p-2`}>
          {(() => {
            const Icon = APP_ICON[tile.icon];
            return <Icon className="h-5 w-5 text-charcoal-ink/70" />;
          })()}
        </span>
        <span className="text-sm font-medium text-charcoal-ink">{tile.label}</span>
      </div>

      {tile.kind === "condition" && (
        <div className="space-y-1">
          <Label htmlFor="goal-focus">What kind of goal is this?</Label>
          <select
            id="goal-focus"
            value={module}
            onChange={(e) => setModule(e.target.value as GoalModule)}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="diet">Food & drinks</option>
            <option value="activity">Activity</option>
            <option value="behaviour">Mood & mindset</option>
            <option value="sleep">Sleep</option>
            <option value="smoking">Stop smoking</option>
          </select>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="goal-title">Your goal</Label>
        <Input id="goal-title" name="title" placeholder={tile.placeholder} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="goal-target-value">Target (optional)</Label>
          <Input id="goal-target-value" name="targetValue" type="number" step="any" placeholder="e.g. 5" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="goal-target-unit">Unit</Label>
          <Input id="goal-target-unit" name="targetUnit" placeholder="e.g. days/week" />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="goal-target-date">By when (optional)</Label>
        <Input id="goal-target-date" name="targetDate" type="date" />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" className="w-full">
        Save goal
      </Button>
    </form>
  );
}

function PastGoalsList({ goals }: { goals: PastLifestyleGoalView[] }) {
  if (goals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No past goals yet, goals you complete or let go of will show up here.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {goals.map((g) => (
        <li key={g.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium text-charcoal-ink">{g.title}</p>
            <p className="text-xs text-muted-foreground">
              {g.conditionLabel} · {new Date(g.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <Badge variant={g.status === "achieved" ? "green" : "grey"}>{g.status}</Badge>
        </li>
      ))}
    </ul>
  );
}
