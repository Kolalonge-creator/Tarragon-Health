"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSmokingProfile, useSmokingCheckIns, smokeFreeStreak } from "@/lib/queries/smoking";
import {
  setSmokingProfileAction,
  logSmokingCheckInAction,
  type SmokingActionState,
} from "./actions";
import {
  SMOKING_STATUSES,
  SMOKING_STATUS_LABELS,
  SMOKING_TRIGGERS,
  SMOKING_TRIGGER_LABELS,
} from "@/lib/validation/smoking";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LifestyleBarrierPicker } from "@/components/lifestyle-barrier-picker";
import { SEMANTIC_ICON } from "@/lib/icons";

import { formatPatientDate } from "@/lib/format-date";
const PROFILE_KEY = "smoking-profile";
const CHECKINS_KEY = "smoking-check-ins";

export function SmokingClient({ patientId }: { patientId: string }) {
  const profile = useSmokingProfile(patientId);
  const checkIns = useSmokingCheckIns(patientId);

  const streak = useMemo(() => smokeFreeStreak(checkIns.data ?? []), [checkIns.data]);
  const status = profile.data?.status ?? "never";

  return (
    <div className="space-y-6">
      <ProfileCard patientId={patientId} profile={profile.data} />

      {status === "current" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Today&apos;s check-in</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckInForm patientId={patientId} />
          </CardContent>
        </Card>
      )}

      {(status === "current" || status === "former") && streak > 0 && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <SEMANTIC_ICON.smoking className="h-6 w-6 text-brand-green dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              {streak} smoke-free day{streak === 1 ? "" : "s"} in a row
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex items-center justify-between gap-3 pt-6">
          <div>
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">Want some support?</p>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Read up on quitting, or message your care team if you&apos;d like a hand.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/patient/learn" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
              Learn
            </Link>
            <Link href="/patient/messages" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
              Message care team
            </Link>
          </div>
        </CardContent>
      </Card>

      <LifestyleBarrierPicker domain="smoking" />

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {checkIns.isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
          {!checkIns.isLoading && (checkIns.data?.length ?? 0) === 0 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Nothing logged yet.</p>
          )}
          <ul className="space-y-2">
            {(checkIns.data ?? []).map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    {formatPatientDate(entry.logged_on, {
                      month: "long",
                      day: "numeric",
                    })}:{" "}
                    {entry.cigarettes_smoked === 0 ? "Smoke-free" : `${entry.cigarettes_smoked} cigarettes`}
                  </p>
                  {entry.triggers.length > 0 && (
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      Triggers: {entry.triggers.map((t) => SMOKING_TRIGGER_LABELS[t]).join(", ")}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileCard({
  patientId,
  profile,
}: {
  patientId: string;
  profile: ReturnType<typeof useSmokingProfile>["data"];
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!profile);
  const [status, setStatus] = useState(profile?.status ?? "never");

  const [state, formAction, pending] = useActionState<SmokingActionState, FormData>(
    async (prev, formData) => {
      const result = await setSmokingProfileAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [PROFILE_KEY, patientId] });
        setEditing(false);
      }
      return result;
    },
    undefined,
  );

  if (!editing && profile) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>{SMOKING_STATUS_LABELS[profile.status]}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Update
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          {profile.status === "current" && profile.cigarettes_per_day != null && (
            <p>{profile.cigarettes_per_day} cigarettes/day</p>
          )}
          {profile.quit_date && <p>Quit date: {formatPatientDate(profile.quit_date)}</p>}
          {profile.quit_motivation != null && <p>Quit motivation: {profile.quit_motivation}/10</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your smoking status</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <div className="grid gap-1">
            <Label htmlFor="status">Status</Label>
            <Select
              id="status"
              name="status"
              defaultValue={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              {SMOKING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SMOKING_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {status === "current" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="cigarettes_per_day">Cigarettes per day</Label>
                <Input
                  id="cigarettes_per_day"
                  name="cigarettes_per_day"
                  type="number"
                  min={0}
                  defaultValue={profile?.cigarettes_per_day ?? undefined}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="years_smoking">Years smoking</Label>
                <Input
                  id="years_smoking"
                  name="years_smoking"
                  type="number"
                  min={0}
                  step={0.5}
                  defaultValue={profile?.years_smoking ?? undefined}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="quit_motivation">
                  Quit motivation (0-10)
                </Label>
                <Input
                  id="quit_motivation"
                  name="quit_motivation"
                  type="number"
                  min={0}
                  max={10}
                  defaultValue={profile?.quit_motivation ?? undefined}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="quit_date">Target quit date</Label>
                <Input id="quit_date" name="quit_date" type="date" defaultValue={profile?.quit_date ?? undefined} />
              </div>
            </div>
          )}
          {state?.error && <p className="text-sm text-destructive dark:text-red-400">{state.error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {profile && (
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CheckInForm({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState<SmokingActionState, FormData>(
    async (prev, formData) => {
      const result = await logSmokingCheckInAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [CHECKINS_KEY, patientId] });
      }
      return result;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="cigarettes_smoked">Cigarettes today</Label>
          <Input id="cigarettes_smoked" name="cigarettes_smoked" type="number" min={0} defaultValue={0} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cravings_intensity">Cravings (0-10)</Label>
          <Input id="cravings_intensity" name="cravings_intensity" type="number" min={0} max={10} />
        </div>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Any triggers today?</legend>
        <div className="flex flex-wrap gap-2">
          {SMOKING_TRIGGERS.map((t) => (
            <label key={t} className="flex items-center gap-1.5 rounded-full border border-charcoal-ink/15 dark:border-night-ink/20 px-3 py-1 text-xs">
              <input type="checkbox" name="triggers" value={t} className="h-3 w-3" />
              {SMOKING_TRIGGER_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>
      {state?.error && <p className="text-sm text-destructive dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green dark:text-brand-green-bright">Logged.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save check-in"}
      </Button>
    </form>
  );
}
