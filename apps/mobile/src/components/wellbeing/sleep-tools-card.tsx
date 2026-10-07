import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SLEEP_SCREEN_ITEM_IDS, getProposedConfig, sleepScreenMessageKey, weeklySleepFeedback, type SleepScreenAnswer, type SleepScreenResult } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const STEPS = ["screens_away", "dim_lights", "quiet_audio", "breathing", "write_down_thoughts", "prepare_tomorrow"] as const;
const LEAD = [15, 30, 45, 60, 90] as const;
const lagos = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

/**
 * Sleep tools on the phone (S57): the weekly view as separate plain numbers (no single score, no advice), the wind-down planner and, when the
 * server says it is open, the snoring and sleepiness questions (the server decides every result; an unsigned instrument shows none).
 * Recording a night's diary stays on the existing sleep logging.
 */
export function SleepToolsCard({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("sleep.winddown.title")}</Text>
        <MutedText>{t("sleep.winddown.intro")}</MutedText>
        <SecondaryButton title={t("library.open")} onPress={() => setOpen(true)} />
      </Card>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Weekly patientId={patientId} />
      <WindDown patientId={patientId} />
      <Questions />
      <SecondaryButton title={t("library.back")} onPress={() => setOpen(false)} />
    </View>
  );
}

function Weekly({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [fb, setFb] = useState<ReturnType<typeof weeklySleepFeedback> | null>(null);
  useEffect(() => {
    void supabase.from("sleep_log_entries").select("logged_on, duration_hours, bedtime, waketime, sleep_latency_minutes, night_awakenings").eq("patient_id", patientId).gte("logged_on", lagos(-13)).then(({ data }) => {
      const rows = data ?? [];
      const start = lagos(-6);
      const eps = (getProposedConfig("media_library.config").value as unknown as { sleep_feedback: { change_epsilon_pct: number } }).sleep_feedback.change_epsilon_pct;
      setFb(weeklySleepFeedback(rows.filter((r) => r.logged_on >= start), rows.filter((r) => r.logged_on < start), eps));
    });
  }, [patientId]);
  if (!fb || fb.nights === 0) return null;
  const trend = fb.shareTrend === "higher" ? "sleep.weekly.trend_higher" : fb.shareTrend === "lower" ? "sleep.weekly.trend_lower" : fb.shareTrend === "about_the_same" ? "sleep.weekly.trend_same" : "sleep.weekly.trend_unknown";
  return (
    <Card style={{ gap: 4 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("sleep.weekly.title")}</Text>
      <MutedText>{t("sleep.weekly.nights", "en", { n: fb.nights })}</MutedText>
      {fb.averageSleepHours !== null && <MutedText>{t("sleep.weekly.average_sleep", "en", { n: fb.averageSleepHours })}</MutedText>}
      {fb.averageInBedHours !== null && <MutedText>{t("sleep.weekly.average_in_bed", "en", { n: fb.averageInBedHours })}</MutedText>}
      {fb.sleepShareOfTimeInBedPct !== null && <MutedText>{t("sleep.weekly.share", "en", { n: fb.sleepShareOfTimeInBedPct })}</MutedText>}
      <MutedText>{t(trend)}</MutedText>
      <MutedText>{t("sleep.weekly.no_score_note")}</MutedText>
    </Card>
  );
}

function WindDown({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [lead, setLead] = useState<number>(45);
  const [steps, setSteps] = useState<string[]>([]);
  const [bed, setBed] = useState<string | null>(null);
  const [msg, setMsg] = useState<"saved" | "error" | null>(null);
  useEffect(() => {
    void supabase.from("sleep_wind_down_plans").select("lead_minutes, steps").eq("patient_id", patientId).maybeSingle().then(({ data }) => {
      if (data) { setLead(data.lead_minutes); setSteps(data.steps); }
    });
    void supabase.from("patient_sleep_goals").select("target_bedtime").eq("patient_id", patientId).maybeSingle().then(({ data }) => setBed(data?.target_bedtime?.slice(0, 5) ?? null));
  }, [patientId]);
  const start = (() => {
    if (!bed) return null;
    const [h, m] = bed.split(":").map(Number);
    const total = (((h ?? 0) * 60 + (m ?? 0) - lead) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  })();
  const save = useCallback(async () => {
    const { error } = await supabase.rpc("save_wind_down_plan", { p_lead_minutes: lead, p_steps: steps, p_reminder: false });
    setMsg(error ? "error" : "saved");
  }, [lead, steps]);
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("sleep.winddown.title")}</Text>
      <MutedText>{start ? t("sleep.winddown.start_at", "en", { time: start }) : t("sleep.winddown.set_goal")}</MutedText>
      <MutedText>{t("sleep.winddown.lead")}</MutedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {LEAD.map((m) => (<SecondaryButton key={m} title={`${m}${lead === m ? " *" : ""}`} onPress={() => setLead(m)} />))}
      </View>
      <MutedText>{t("sleep.winddown.steps")}</MutedText>
      {STEPS.map((s) => (
        <SecondaryButton key={s} title={`${steps.includes(s) ? "[x] " : "[ ] "}${t(`sleep.winddown.step.${s}` as MessageKey)}`} onPress={() => setSteps(steps.includes(s) ? steps.filter((x) => x !== s) : [...steps, s])} />
      ))}
      <PrimaryButton title={t("sleep.winddown.save")} onPress={save} />
      {msg === "saved" && <Text accessibilityRole="alert" style={{ color: colors.ink }}>{t("sleep.winddown.saved")}</Text>}
      {msg === "error" && <ErrorText>{t("sleep.winddown.error")}</ErrorText>}
    </Card>
  );
}

function Questions() {
  const colors = useLegacyColors();
  const [inst, setInst] = useState<{ open: boolean; items?: string[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, SleepScreenAnswer>>({});
  const [result, setResult] = useState<SleepScreenResult | null>(null);
  const [err, setErr] = useState<"incomplete" | "error" | null>(null);
  useEffect(() => {
    void supabase.rpc("get_sleep_apnoea_instrument").then(({ data }) => setInst((data ?? { open: false }) as { open: boolean; items?: string[] }));
  }, []);
  if (!inst?.open || !inst.items) return null;
  const items = inst.items;
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("sleep.screen.title")}</Text>
      {result ? (
        <Text accessibilityRole="alert" style={{ color: colors.ink }}>{t(sleepScreenMessageKey(result))}</Text>
      ) : (
        <>
          <MutedText>{t("sleep.screen.intro")}</MutedText>
          {items.map((id) => (
            <View key={id} style={{ gap: 4 }}>
              <Text style={{ color: colors.ink }}>{(SLEEP_SCREEN_ITEM_IDS as readonly string[]).includes(id) ? t(`sleep.screen.item.${id}` as MessageKey) : id}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {(["yes", "no", "unsure"] as const).map((a) => (
                  <SecondaryButton key={a} title={`${answers[id] === a ? "* " : ""}${t(`sleep.screen.${a}` as MessageKey)}`} onPress={() => setAnswers({ ...answers, [id]: a })} />
                ))}
              </View>
            </View>
          ))}
          <PrimaryButton
            title={t("sleep.screen.submit")}
            onPress={async () => {
              setErr(null);
              if (items.some((id) => !answers[id])) return setErr("incomplete");
              const { data, error } = await supabase.rpc("submit_sleep_apnoea_screen", { p_answers: answers });
              if (error) return setErr("error");
              setResult(data as unknown as SleepScreenResult);
            }}
          />
          {err === "incomplete" && <ErrorText>{t("sleep.screen.answer_all")}</ErrorText>}
          {err === "error" && <ErrorText>{t("sleep.screen.error")}</ErrorText>}
        </>
      )}
    </Card>
  );
}
