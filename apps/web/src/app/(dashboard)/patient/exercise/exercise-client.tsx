"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExerciseProgrammes,
  useLatestReadinessScreen,
  useExerciseEnrollments,
  clearsForModerate,
  clearsForVigorous,
  type ExerciseProgramme,
} from "@/lib/queries/exercise";
import {
  submitReadinessScreenAction,
  enrollExerciseProgrammeAction,
  type ExerciseActionState,
} from "./actions";
import { READINESS_QUESTIONS } from "@/lib/validation/exercise";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const SCREEN_KEY = "exercise-readiness-screen";
const ENROLLMENTS_KEY = "exercise-enrollments";

const INTENSITY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  moderate: "Moderate",
  vigorous: "Vigorous",
};

export function ExerciseClient({ patientId }: { patientId: string }) {
  const programmes = useExerciseProgrammes();
  const screen = useLatestReadinessScreen(patientId);
  const enrollments = useExerciseEnrollments(patientId);

  const okModerate = clearsForModerate(screen.data);
  const okVigorous = clearsForVigorous(screen.data);

  return (
    <div className="space-y-6">
      <ReadinessCard patientId={patientId} screen={screen.data} />

      {(enrollments.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your programmes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(enrollments.data ?? []).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 p-3">
                <p className="text-sm font-medium text-charcoal-ink">{e.programme?.title}</p>
                <Badge variant={e.status === "active" ? "green" : "grey"}>{e.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Programme catalogue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {programmes.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {(programmes.data ?? []).map((p) => (
            <ProgrammeRow
              key={p.id}
              patientId={patientId}
              programme={p}
              cleared={p.intensity_level === "beginner" || (p.intensity_level === "moderate" ? okModerate : okVigorous)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ReadinessCard({
  patientId,
  screen,
}: {
  patientId: string;
  screen: ReturnType<typeof useLatestReadinessScreen>["data"];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ExerciseActionState, FormData>(
    async (prev, formData) => {
      const result = await submitReadinessScreenAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [SCREEN_KEY, patientId] });
        setOpen(false);
      }
      return result;
    },
    undefined,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Exercise readiness</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : screen ? "Retake" : "Take the screen"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {screen && !open && (
          <p className="text-sm text-charcoal-ink/70">
            {screen.cleared_for_intensive
              ? "Your care team has cleared you for a more intensive programme."
              : screen.any_flag
                ? "You flagged something worth a clinician's look before starting a moderate or vigorous programme. Your care team will review it."
                : "No concerns flagged. You're clear to start a moderate-intensity programme. Vigorous programmes still need a clinician's sign-off."}
          </p>
        )}
        {!screen && !open && (
          <p className="text-sm text-charcoal-ink/60">
            A beginner programme (walking, mobility) needs no screen. Anything more intensive asks a
            few quick safety questions first.
          </p>
        )}
        {open && (
          <form action={formAction} className="space-y-3">
            {READINESS_QUESTIONS.map((q) => (
              <label key={q.name} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={q.name} className="mt-1" />
                <span>{q.label}</span>
              </label>
            ))}
            <Textarea name="other_concern" placeholder="Anything else your care team should know? (optional)" rows={2} />
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Submit"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ProgrammeRow({
  patientId,
  programme,
  cleared,
}: {
  patientId: string;
  programme: ExerciseProgramme;
  cleared: boolean;
}) {
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState<ExerciseActionState, FormData>(
    async (prev, formData) => {
      const result = await enrollExerciseProgrammeAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [ENROLLMENTS_KEY, patientId] });
      }
      return result;
    },
    undefined,
  );

  return (
    <div className="rounded-lg border border-charcoal-ink/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">{programme.title}</p>
          <p className="text-xs text-charcoal-ink/60">{programme.summary}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="grey">{INTENSITY_LABEL[programme.intensity_level]}</Badge>
            {!programme.clinician_reviewed && <Badge variant="grey">Not yet clinically reviewed</Badge>}
          </div>
        </div>
        <form action={formAction}>
          <input type="hidden" name="programme_id" value={programme.id} />
          <Button type="submit" size="sm" disabled={pending || !cleared}>
            {cleared ? "Start" : "Needs clearance"}
          </Button>
        </form>
      </div>
      {state?.error && <p className="mt-2 text-xs text-destructive">{state.error}</p>}
      {state?.success && <p className="mt-2 text-xs text-brand-green">Started.</p>}
    </div>
  );
}
