import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import Svg, { Circle, G, Polyline } from "react-native-svg";
import {
  MSK_VIEWBOX, arrowHead, mskShapesForNative, MSK_DRAWING_ALT, selectDailySet, stepDownActive, type EntryQuestion, type MskStartExtras, type TherapyAnswers, type TherapyRoute,
} from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { rateExercise, reportFlareUp } from "@/lib/therapy-programmes";
import { useLegacyColors } from "@/ui/design";
import { Card, ChoiceChip, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

const pts = (p: readonly (readonly [number, number])[]): string => p.map(([x, y]) => `${x},${y}`).join(" ");

/** One exercise drawing (S96): the same shapes the web draws, in the theme's text colour so light and dark both read. Bundled, so it works offline. */
export function MskDrawingNative({ exerciseKey }: { exerciseKey: string }) {
  const colors = useLegacyColors();
  const shapes = mskShapesForNative(exerciseKey);
  if (shapes.length === 0) return null;
  const alt = MSK_DRAWING_ALT[exerciseKey] ?? "";
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={alt} style={{ alignItems: "center" }}>
      <Svg width={180} height={120} viewBox={`0 0 ${MSK_VIEWBOX.width} ${MSK_VIEWBOX.height}`}>
        {shapes.map((s, i) => {
          if (s.t === "c") return <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="none" stroke={colors.ink} strokeWidth={2.5} />;
          if (s.t === "l") {
            return <Polyline key={i} points={pts(s.p)} fill="none" stroke={colors.ink} strokeWidth={s.role === "prop" ? 1.5 : 2.5} strokeLinecap="round" strokeLinejoin="round" opacity={s.role === "prop" ? 0.55 : 1} />;
          }
          const head = arrowHead(s.p);
          return (
            <G key={i} fill="none" stroke={colors.brand} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <Polyline points={pts(s.p)} />
              {head && <Polyline points={pts(head)} />}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The day's exercises for a pain programme (S96) on the phone: steps plus drawing, a rating after each, lighter plan and gate states. */
export function MskDaySetNative({ enrolmentId, ordinal, extras }: { enrolmentId: string; ordinal: number; extras: MskStartExtras }) {
  const colors = useLegacyColors();
  const [rated, setRated] = useState<Record<string, number>>({});
  const [easier, setEasier] = useState<Record<string, boolean>>({});
  const [error, setError] = useState(false);
  const [daysDone, setDaysDone] = useState(extras.daysDone);
  const stepDownRunning = stepDownActive(extras.stepDown, lagosToday());
  const set = selectDailySet(extras.exercises, { gate: extras.gate, stepDownRunning });

  const rate = async (key: string, n: number) => {
    setError(false);
    const r = await rateExercise(enrolmentId, ordinal, key, n);
    if (!r) { setError(true); return; }
    setRated((x) => ({ ...x, [key]: n }));
    setEasier((x) => ({ ...x, [key]: r.offerEasier }));
    if (r.daysDone !== null) setDaysDone(r.daysDone);
  };

  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("therapy.msk.today_title")}</Text>
      <MutedText>{t("therapy.msk.today_intro")}</MutedText>
      {stepDownRunning && extras.stepDown && <Card><MutedText>{t("therapy.msk.step_down_banner", "en", { date: extras.stepDown.until })}</MutedText></Card>}
      {!stepDownRunning && set.reason === "activity_gate" && set.exercises.length > 0 && <Card><MutedText>{t("therapy.msk.gate_gentle")}</MutedText></Card>}
      {extras.gate.decision === "rest" && <Card><MutedText>{t("therapy.msk.gate_rest")}</MutedText></Card>}
      {set.exercises.map((ex) => (
        <Card key={ex.key} style={{ gap: 8 }}>
          <AppText variant="bodyStrong">{ex.name}</AppText>
          <MskDrawingNative exerciseKey={ex.key} />
          <AppText variant="body">{t("therapy.msk.how_much")}: {ex.dose}</AppText>
          <AppText variant="label">{t("therapy.msk.how_to")}</AppText>
          {ex.steps.map((step, i) => <Text key={step} style={{ fontSize: 14, color: colors.ink }}>{i + 1}. {step}</Text>)}
          <AppText variant="body">{t("therapy.msk.easier")}: {ex.easier}</AppText>
          <AppText variant="body">{t("therapy.msk.harder")}: {ex.harder}</AppText>
          <AppText variant="body">{t("therapy.msk.stop_if")}: {ex.stop_if}</AppText>
          <MutedText>{t("therapy.msk.rate_prompt")}</MutedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <ChoiceChip key={n} title={(rated[ex.key] === n ? "* " : "") + t(`therapy.msk.rate_${n}` as MessageKey)} onPress={() => void rate(ex.key, n)} />
            ))}
          </View>
          {rated[ex.key] !== undefined && <MutedText>{t("therapy.msk.rate_saved")}</MutedText>}
          {easier[ex.key] && <AppText variant="bodyStrong">{t("therapy.msk.offer_easier")}</AppText>}
        </Card>
      ))}
      {error && <ErrorText>{t("therapy.msk.rate_error")}</ErrorText>}
      <MutedText>{t("therapy.msk.days_progress", "en", { done: daysDone, needed: extras.daysNeeded })}</MutedText>
    </View>
  );
}

/**
 * "My pain got worse" on the phone (S96). It asks the red-flag questions again; the database re-runs the same deterministic screen. A positive
 * pauses the plan and the care team is told; a clear check records a lighter plan for a few days. `Questions` is the screen's own question form.
 */
export function MskFlareUpNative({
  enrolmentId, questions, Form, Guidance, onBack,
}: {
  enrolmentId: string;
  questions: EntryQuestion[] | null;
  Form: (p: { questions: EntryQuestion[]; label: string; busy: boolean; onSubmit: (a: TherapyAnswers) => void }) => React.ReactElement;
  Guidance: (p: { route: TherapyRoute | null; taskFailed?: boolean; onBack: () => void }) => React.ReactElement;
  onBack: () => void;
}) {
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pain, setPain] = useState("");
  const [result, setResult] = useState<
    | { kind: "stopped"; route: TherapyRoute | null; taskFailed: boolean }
    | { kind: "step_down"; until: string }
    | { kind: "message"; text: string }
    | null
  >(null);

  if (!open) return <SecondaryButton title={t("therapy.msk.flare_button")} onPress={() => setOpen(true)} />;
  if (result?.kind === "stopped") {
    return (
      <View style={{ gap: 8 }}>
        {result.route !== "crisis" && <AppText variant="bodyStrong" accessibilityRole="alert">{t("therapy.msk.flare_paused")}</AppText>}
        <Guidance route={result.route} taskFailed={result.taskFailed} onBack={onBack} />
      </View>
    );
  }
  if (result?.kind === "step_down") {
    return (
      <Card style={{ gap: 8 }}>
        <AppText variant="bodyStrong" accessibilityRole="alert">{t("therapy.msk.flare_step_down")}</AppText>
        <MutedText>{t("therapy.msk.step_down_banner", "en", { date: result.until })}</MutedText>
      </Card>
    );
  }
  if (result?.kind === "message") return <ErrorText>{result.text}</ErrorText>;
  if (!questions) return <ErrorText>{t("therapy.msk.flare_error")}</ErrorText>;

  const submit = async (answers: TherapyAnswers) => {
    setBusy(true);
    const painNow = /^\d{1,2}$/.test(pain) && Number(pain) <= 10 ? Number(pain) : undefined;
    const o = await reportFlareUp(enrolmentId, answers, painNow);
    setBusy(false);
    if (o.kind === "stopped") setResult({ kind: "stopped", route: o.route, taskFailed: o.taskFailed });
    else if (o.kind === "step_down") setResult({ kind: "step_down", until: o.until });
    else if (o.kind === "not_active") setResult({ kind: "message", text: t("therapy.msk.flare_not_active") });
    else setResult({ kind: "message", text: t("therapy.msk.flare_error") });
  };

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("therapy.msk.flare_title")}</Text>
      <MutedText>{t("therapy.msk.flare_intro")}</MutedText>
      <AppText variant="body">{t("therapy.msk.flare_pain_now")}</AppText>
      <TextInput
        accessibilityLabel={t("therapy.msk.flare_pain_now")}
        keyboardType="number-pad"
        value={pain}
        onChangeText={(v) => setPain(v.replace(/\D/g, "").slice(0, 2))}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, width: 70, color: colors.ink }}
      />
      <Form questions={questions} label={t("therapy.msk.flare_submit")} busy={busy} onSubmit={(a) => void submit(a)} />
    </Card>
  );
}

