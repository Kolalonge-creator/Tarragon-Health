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
import { HeroMetric } from "@/components/ui/hero-metric";
import { SheetButton } from "@/components/ui/sheet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LifestyleBarrierPicker } from "@/components/lifestyle-barrier-picker";
import { useT } from "@/components/ui-language-provider";

import { formatPatientDate } from "@/lib/format-date";
const PROFILE_KEY = "smoking-profile";
const CHECKINS_KEY = "smoking-check-ins";

export function SmokingClient({ patientId }: { patientId: string }) {
  const t = useT();
  const profile = useSmokingProfile(patientId);
  const checkIns = useSmokingCheckIns(patientId);

  const streak = useMemo(() => smokeFreeStreak(checkIns.data ?? []), [checkIns.data]);
  const status = profile.data?.status ?? "never";

  return (
    <div className="space-y-6">
      {/* The page opens on the smoke-free streak (when there is one to show); the status form and the daily check-in are one tap away in
          sheets instead of forms on the page (design audit P4). */}
      {(status === "current" || status === "former") && (
        <HeroMetric
          label={t("Smoke-free")}
          value={checkIns.isLoading || checkIns.isError ? null : streak > 0 ? String(streak) : null}
          unit={streak === 1 ? "day in a row" : "days in a row"}
          emptyText={checkIns.isError ? t("We couldn't load this just now. Try again in a moment.") : checkIns.isLoading ? t("Loading…") : t("Log a check-in to start your streak.")}
        />
      )}

      <ProfileCard patientId={patientId} profile={profile.data} isLoading={profile.isLoading} />

      {status === "current" && (
        <div>
          <SheetButton variant="default" label={t("Today's check-in")}>
            {(close) => <CheckInForm patientId={patientId} onDone={close} />}
          </SheetButton>
        </div>
      )}

      <Card>
        <CardContent className="flex items-center justify-between gap-3 pt-6">
          <div>
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("Want some support?")}</p>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              {t("Read up on quitting, or message your care team if you'd like a hand.")}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/patient/learn" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
              {t("Learn")}
            </Link>
            <Link href="/patient/messages" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
              {t("Message care team")}
            </Link>
          </div>
        </CardContent>
      </Card>

      <LifestyleBarrierPicker domain="smoking" />

      <Card>
        <CardHeader>
          <CardTitle>{t("History")}</CardTitle>
        </CardHeader>
        <CardContent>
          {checkIns.isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("Loading…")}</p>}
          {!checkIns.isLoading && (checkIns.data?.length ?? 0) === 0 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("Nothing logged yet.")}</p>
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

function ProfileForm({
  patientId,
  profile,
  onDone,
}: {
  patientId: string;
  profile: ReturnType<typeof useSmokingProfile>["data"];
  onDone: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  // Derived from `profile` every render and only overridden once the patient picks something in this edit session: a useState
  // initialiser seeded from an async query froze on "never" and could silently overwrite a saved "current"/"former" status
  // (the 2026-09-24 audit bug). This form mounts when the sheet opens, by which time the profile has loaded.
  const [statusOverride, setStatusOverride] = useState<(typeof SMOKING_STATUSES)[number] | null>(null);
  const status = statusOverride ?? profile?.status ?? "never";

  const [state, formAction, pending] = useActionState<SmokingActionState, FormData>(
    async (prev, formData) => {
      const result = await setSmokingProfileAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [PROFILE_KEY, patientId] });
        onDone();
      }
      return result;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-1">
        <Label htmlFor="status">{t("Status")}</Label>
        <Select
          id="status"
          name="status"
          defaultValue={status}
          onChange={(e) => setStatusOverride(e.target.value as typeof status)}
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
            <Label htmlFor="cigarettes_per_day">{t("Cigarettes per day")}</Label>
            <Input
              id="cigarettes_per_day"
              name="cigarettes_per_day"
              type="number"
              min={0}
              defaultValue={profile?.cigarettes_per_day ?? undefined}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="years_smoking">{t("Years smoking")}</Label>
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
            <Label htmlFor="quit_motivation">{t("Quit motivation (0-10)")}</Label>
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
            <Label htmlFor="quit_date">{t("Target quit date")}</Label>
            <Input id="quit_date" name="quit_date" type="date" defaultValue={profile?.quit_date ?? undefined} />
          </div>
        </div>
      )}
      {state?.error && <p className="text-sm text-destructive dark:text-red-400">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("Saving…") : t("Save")}
      </Button>
    </form>
  );
}

// Exported for testing only (smoking-client.test.tsx) — every other
// consumer should still go through SmokingClient.
export function ProfileCard({
  patientId,
  profile,
  isLoading,
}: {
  patientId: string;
  profile: ReturnType<typeof useSmokingProfile>["data"];
  isLoading: boolean;
}) {
  const t = useT();
  // The status form lives in a sheet (design audit P4): with no profile yet the card is a calm prompt, not an open form.
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{profile ? SMOKING_STATUS_LABELS[profile.status] : t("Your smoking status")}</CardTitle>
        {!isLoading && (
          <SheetButton size="sm" label={profile ? t("Update") : t("Set your status")} title={t("Your smoking status")}>
            {(close) => <ProfileForm patientId={patientId} profile={profile} onDone={close} />}
          </SheetButton>
        )}
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        {!profile && <p>{isLoading ? t("Loading…") : t("Tell us where you are with smoking and we will show what helps.")}</p>}
        {profile?.status === "current" && profile.cigarettes_per_day != null && (
          <p>{profile.cigarettes_per_day} cigarettes/day</p>
        )}
        {profile?.quit_date && <p>Quit date: {formatPatientDate(profile.quit_date)}</p>}
        {profile?.quit_motivation != null && <p>Quit motivation: {profile.quit_motivation}/10</p>}
      </CardContent>
    </Card>
  );
}

function CheckInForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState<SmokingActionState, FormData>(
    async (prev, formData) => {
      const result = await logSmokingCheckInAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [CHECKINS_KEY, patientId] });
        onDone();
      }
      return result;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="cigarettes_smoked">{t("Cigarettes today")}</Label>
          <Input id="cigarettes_smoked" name="cigarettes_smoked" type="number" min={0} defaultValue={0} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cravings_intensity">{t("Cravings (0-10)")}</Label>
          <Input id="cravings_intensity" name="cravings_intensity" type="number" min={0} max={10} />
        </div>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("Any triggers today?")}</legend>
        <div className="flex flex-wrap gap-2">
          {SMOKING_TRIGGERS.map((trigger) => (
            <label key={trigger} className="flex items-center gap-1.5 rounded-full border border-charcoal-ink/15 dark:border-night-ink/20 px-3 py-1 text-xs">
              <input type="checkbox" name="triggers" value={trigger} className="h-3 w-3" />
              {SMOKING_TRIGGER_LABELS[trigger]}
            </label>
          ))}
        </div>
      </fieldset>
      {state?.error && <p className="text-sm text-destructive dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green dark:text-brand-green-bright">{t("Logged.")}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("Saving…") : t("Save check-in")}
      </Button>
    </form>
  );
}
