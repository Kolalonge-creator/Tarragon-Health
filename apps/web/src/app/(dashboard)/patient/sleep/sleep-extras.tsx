"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProposedConfig, SLEEP_SCREEN_ITEM_IDS, sleepScreenMessageKey, weeklySleepFeedback, type SleepScreenAnswer, type SleepScreenResult } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { useSleepLogEntries } from "@/lib/queries/sleep";
import { SharedPhoneGate } from "@/components/mental-health/shared-phone-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * S57 sleep tools on the sleep page: the weekly view (separate plain numbers, no single score, no advice), the wind-down planner and the
 * snoring and sleepiness questionnaire (shown only when the server says it is open; the server decides every result).
 */
const STEPS = ["screens_away", "dim_lights", "quiet_audio", "breathing", "write_down_thoughts", "prepare_tomorrow"] as const;
const LEAD = [15, 30, 45, 60, 90] as const;

function lagosDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export function SleepExtras({ patientId, bedtimeGoal }: { patientId: string; bedtimeGoal: string | null }) {
  return (
    <SharedPhoneGate>
      <div className="space-y-6">
        <WeeklyCard patientId={patientId} />
        <WindDownCard patientId={patientId} bedtimeGoal={bedtimeGoal} />
        <SleepScreenCard />
      </div>
    </SharedPhoneGate>
  );
}

function WeeklyCard({ patientId }: { patientId: string }) {
  const entries = useSleepLogEntries(patientId, 14);
  const epsilon = (getProposedConfig("media_library.config").value as { sleep_feedback: { change_epsilon_pct: number } }).sleep_feedback.change_epsilon_pct;
  const fb = useMemo(() => {
    const rows = entries.data ?? [];
    const start = lagosDate(-6);
    const prevStart = lagosDate(-13);
    const mine = (r: (typeof rows)[number]) => ({ logged_on: r.logged_on, duration_hours: r.duration_hours, bedtime: r.bedtime, waketime: r.waketime, sleep_latency_minutes: r.sleep_latency_minutes, night_awakenings: r.night_awakenings });
    const thisWeek = rows.filter((r) => r.logged_on >= start).map(mine);
    const lastWeek = rows.filter((r) => r.logged_on >= prevStart && r.logged_on < start).map(mine);
    return weeklySleepFeedback(thisWeek, lastWeek, epsilon);
  }, [entries.data, epsilon]);

  if (entries.isLoading || fb.nights === 0) return null;
  const trendKey = (tr: typeof fb.shareTrend) =>
    tr === "higher" ? "sleep.weekly.trend_higher" : tr === "lower" ? "sleep.weekly.trend_lower" : tr === "about_the_same" ? "sleep.weekly.trend_same" : "sleep.weekly.trend_unknown";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sleep.weekly.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>{t("sleep.weekly.nights", "en", { n: fb.nights })}</p>
        {fb.averageSleepHours !== null && <p>{t("sleep.weekly.average_sleep", "en", { n: fb.averageSleepHours })}</p>}
        {fb.averageInBedHours !== null && <p>{t("sleep.weekly.average_in_bed", "en", { n: fb.averageInBedHours })}</p>}
        {fb.sleepShareOfTimeInBedPct !== null && <p>{t("sleep.weekly.share", "en", { n: fb.sleepShareOfTimeInBedPct })}</p>}
        {fb.earliestBedtime && fb.latestBedtime && <p>{t("sleep.weekly.bedtime_range", "en", { from: fb.earliestBedtime, to: fb.latestBedtime })}</p>}
        {fb.averageMinutesToFallAsleep !== null && <p>{t("sleep.weekly.fall_asleep", "en", { n: fb.averageMinutesToFallAsleep })}</p>}
        {fb.averageNightWakings !== null && <p>{t("sleep.weekly.wakings", "en", { n: fb.averageNightWakings })}</p>}
        <p className="pt-1 text-charcoal-ink/70 dark:text-night-ink/70">{t(trendKey(fb.shareTrend))}</p>
        <p className="pt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("sleep.weekly.no_score_note")}</p>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("sleep.weekly.talk_to_care_team")}</p>
      </CardContent>
    </Card>
  );
}

function startTime(bedtime: string, lead: number): string {
  const [h, m] = bedtime.split(":").map(Number);
  const total = ((h ?? 0) * 60 + (m ?? 0) - lead + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function WindDownCard({ patientId, bedtimeGoal }: { patientId: string; bedtimeGoal: string | null }) {
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ["sleep-wind-down", patientId],
    queryFn: async () => {
      const { data, error } = await createClient().from("sleep_wind_down_plans").select("lead_minutes, steps").eq("patient_id", patientId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // What the person has changed on screen; anything untouched shows the saved plan.
  const [leadEdit, setLead] = useState<number | null>(null);
  const [stepsEdit, setSteps] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<"saved" | "error" | null>(null);
  const lead = leadEdit ?? plan.data?.lead_minutes ?? 45;
  const steps = stepsEdit ?? plan.data?.steps ?? [];

  async function save() {
    setMsg(null);
    const { error } = await createClient().rpc("save_wind_down_plan", { p_lead_minutes: lead, p_steps: steps, p_reminder: false });
    if (error) return setMsg("error");
    setMsg("saved");
    void qc.invalidateQueries({ queryKey: ["sleep-wind-down", patientId] });
  }

  const bed = bedtimeGoal ? bedtimeGoal.slice(0, 5) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sleep.winddown.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("sleep.winddown.intro")}</p>
        {bed ? (
          <p className="text-sm font-medium">{t("sleep.winddown.start_at", "en", { time: startTime(bed, lead) })} ({t("sleep.winddown.bedtime")}: {bed})</p>
        ) : (
          <p className="text-sm">{t("sleep.winddown.set_goal")}</p>
        )}
        <div className="grid gap-1">
          <Label htmlFor="wind-lead">{t("sleep.winddown.lead")}</Label>
          <select id="wind-lead" value={lead} onChange={(e) => setLead(Number(e.target.value))} className="w-32 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm">
            {LEAD.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("sleep.winddown.steps")}</legend>
          {STEPS.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={steps.includes(s)} onChange={(e) => setSteps(e.target.checked ? [...steps, s] : steps.filter((x) => x !== s))} />
              {t(`sleep.winddown.step.${s}` as const)}
            </label>
          ))}
        </fieldset>
        <Button type="button" onClick={save}>{t("sleep.winddown.save")}</Button>
        {msg === "saved" && <p role="status" className="text-sm text-brand-green dark:text-brand-green-bright">{t("sleep.winddown.saved")}</p>}
        {msg === "error" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("sleep.winddown.error")}</p>}
      </CardContent>
    </Card>
  );
}

function SleepScreenCard() {
  const inst = useQuery({
    queryKey: ["sleep-apnoea-instrument"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("get_sleep_apnoea_instrument");
      if (error) throw error;
      return data as { open: boolean; signed?: boolean; items?: string[] };
    },
  });
  const [answers, setAnswers] = useState<Record<string, SleepScreenAnswer>>({});
  const [result, setResult] = useState<SleepScreenResult | null>(null);
  const [err, setErr] = useState<"incomplete" | "error" | null>(null);
  if (!inst.data?.open || !inst.data.items) return null;
  const items = inst.data.items;

  async function submit() {
    setErr(null);
    if (items.some((id) => !answers[id])) return setErr("incomplete");
    const { data, error } = await createClient().rpc("submit_sleep_apnoea_screen", { p_answers: answers });
    if (error) return setErr("error");
    setResult(data as unknown as SleepScreenResult);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sleep.screen.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result ? (
          <p role="status" className="text-sm">{t(sleepScreenMessageKey(result))}</p>
        ) : (
          <>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("sleep.screen.intro")}</p>
            {items.map((id) => {
              const known = (SLEEP_SCREEN_ITEM_IDS as readonly string[]).includes(id);
              return (
                <fieldset key={id} className="space-y-1">
                  <legend className="text-sm">{known ? t(`sleep.screen.item.${id}` as "sleep.screen.item.snoring") : id}</legend>
                  <div className="flex gap-4">
                    {(["yes", "no", "unsure"] as const).map((a) => (
                      <label key={a} className="flex items-center gap-1 text-sm">
                        <input type="radio" name={`sleep-${id}`} checked={answers[id] === a} onChange={() => setAnswers({ ...answers, [id]: a })} />
                        {t(`sleep.screen.${a}` as const)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            <Button type="button" onClick={submit}>{t("sleep.screen.submit")}</Button>
            {err === "incomplete" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("sleep.screen.answer_all")}</p>}
            {err === "error" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("sleep.screen.error")}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

