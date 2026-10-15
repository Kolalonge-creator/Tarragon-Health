import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import {
  SEED_PATHWAYS,
  type Onset,
  type SymptomCapture,
} from "@tarragon/symptom-triage-engine";
import { getSymptomCheckerState, postSymptomStep, type SymptomCheckerState, type SymptomStepResponse } from "@/lib/api";
import { categoryMessageKey, keepMoreUrgent, offlineResult, viewFor } from "@/lib/symptom-check-model";
import { screenRedFlagsOnDevice } from "@/lib/symptom-red-flags";
import { Card, ChoiceChip, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { useLegacyColors } from "@/ui/design";
import { NotADiagnosis } from "@/ui/not-a-diagnosis";

/**
 * S59b: the mobile symptom checker (English only, text first). Order of events is the safety rule (spec 12.8, INV-06):
 *   1. the red-flag floor runs ON THE PHONE from the bundled rules the moment the checklist is submitted, and an emergency is shown
 *      at once, whatever the server does or does not answer;
 *   2. the question walk and the recording go through the bearer-authenticated /api/mobile/symptom-check, which is the web's own code;
 *   3. if the server cannot be reached, the phone shows "needs prompt attention", never "all clear".
 * Behind the symptom_checker_enabled guard and FAILS CLOSED (no answer from the server reads as closed). Under 18, or no date of birth,
 * gets a calm block. No analytics SDK is used anywhere here. The checker has no free-text answers today; any typed box added later must
 * stay a plain TextInput so the phone keyboard's own dictation works (no voice code of ours, no server speech-to-text).
 */
type Stage =
  | { step: "pick" }
  | { step: "capture"; complaintKey: string }
  | { step: "question"; question: Extract<SymptomStepResponse, { status: "in_progress" }>["question"]; capture: SymptomCapture; answers: Record<string, boolean | string>; questionLog: Extract<SymptomStepResponse, { status: "in_progress" }>["state"]["questionLog"] }
  | { step: "result"; category: string; onDevice: boolean; degraded: boolean; recorded: boolean }
  | { step: "blocked"; reason: "under_18" | "dob_required" }
  | { step: "error" };

const SYMPTOM_LABEL = (key: string): string => {
  const k = `symptom.opt.${key}`;
  const label = (t as (k: string) => string)(k);
  return !label || label === k ? key.replace(/_/g, " ") : label;
};

export function SymptomCheckerCard({ actingForSomeoneElse }: { actingForSomeoneElse: boolean }) {
  const colors = useLegacyColors();
  const [state, setState] = useState<SymptomCheckerState | null | undefined>(undefined);
  const [stage, setStage] = useState<Stage>({ step: "pick" });
  const [busy, setBusy] = useState(false);
  const [shownEmergency, setShownEmergency] = useState(false);

  useEffect(() => {
    let live = true;
    getSymptomCheckerState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);

  const finish = useCallback(
    (r: SymptomStepResponse | null, capture: SymptomCapture) => {
      if (r === null || r.status === "unavailable" || r.status === "error") {
        const off = offlineResult(capture);
        setStage({ step: "result", category: keepMoreUrgent(shownEmergency, off.category), onDevice: true, degraded: true, recorded: false });
      } else if (r.status === "blocked") {
        setStage({ step: "blocked", reason: r.reason });
      } else if (r.status === "in_progress") {
        setStage({ step: "question", question: r.question, capture: r.state.capture as unknown as SymptomCapture, answers: r.state.answers, questionLog: r.state.questionLog });
      } else {
        setStage({ step: "result", category: keepMoreUrgent(shownEmergency, r.category), onDevice: false, degraded: r.degraded, recorded: r.recorded });
      }
    },
    [shownEmergency],
  );

  if (actingForSomeoneElse) {
    return (
      <Card>
        <MutedText>{t("symptom.mobile.acting_for")}</MutedText>
      </Card>
    );
  }
  const view = viewFor(state);
  if (view.kind === "loading") return null;
  if (view.kind === "closed") {
    return (
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{t("symptom.mobile.title")}</Text>
        <MutedText>{t("symptom.mobile.closed")}</MutedText>
      </Card>
    );
  }
  if (view.kind === "blocked" || stage.step === "blocked") {
    const reason = view.kind === "blocked" ? view.reason : (stage as Extract<Stage, { step: "blocked" }>).reason;
    return (
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{t("symptom.mobile.title")}</Text>
        <View accessibilityRole="alert">
          <MutedText>{t(reason === "under_18" ? "symptom.mobile.blocked.under18" : "symptom.mobile.blocked.dob")}</MutedText>
        </View>
        <NotADiagnosis variant="short" />
      </Card>
    );
  }

  const complaints = state?.complaints ?? [];

  async function submitCapture(capture: SymptomCapture) {
    // 1. the floor, on this phone, before anything else
    const floor = screenRedFlagsOnDevice(capture);
    if (floor.showEmergencyGuidance) {
      setShownEmergency(true);
      setStage({ step: "result", category: "emergency", onDevice: true, degraded: false, recorded: false });
    }
    setBusy(true);
    const r = await postSymptomStep({ capture, answers: {}, questionLog: [] });
    setBusy(false);
    finish(r, capture);
  }

  async function submitAnswer(current: Extract<Stage, { step: "question" }>, value: boolean | string) {
    setBusy(true);
    const answers = { ...current.answers, [current.question.key]: value };
    const r = await postSymptomStep({ capture: current.capture, answers, questionLog: current.questionLog });
    setBusy(false);
    finish(r, current.capture);
  }

  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{t("symptom.mobile.title")}</Text>
      {stage.step === "pick" && (
        <View style={{ gap: 8, marginTop: 8 }}>
          <MutedText>{t("symptom.mobile.pick")}</MutedText>
          {complaints.map((c) => (
            <ChoiceChip key={c.key} title={c.label} onPress={() => setStage({ step: "capture", complaintKey: c.key })} />
          ))}
        </View>
      )}
      {stage.step === "capture" && <CaptureForm complaintKey={stage.complaintKey} busy={busy} onSubmit={submitCapture} />}
      {stage.step === "question" && (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{stage.question.prompt}</Text>
          {stage.question.kind === "boolean" ? (
            <View style={{ gap: 8 }}>
              <PrimaryButton title={t("symptom.mobile.yes")} disabled={busy} onPress={() => submitAnswer(stage, true)} />
              <SecondaryButton title={t("symptom.mobile.no")} disabled={busy} onPress={() => submitAnswer(stage, false)} />
            </View>
          ) : (
            stage.question.options.map((o) => <ChoiceChip key={o.value} title={o.label} disabled={busy} onPress={() => submitAnswer(stage, o.value)} />)
          )}
        </View>
      )}
      {stage.step === "result" && (
        <View style={{ gap: 10, marginTop: 8 }}>
          <View accessibilityRole="alert">
            <Text style={{ fontSize: 15, fontWeight: "600", color: stage.category === "emergency" ? colors.danger : colors.ink }}>
              {t(categoryMessageKey(stage.category))}
            </Text>
          </View>
          {stage.onDevice && <MutedText>{t("symptom.mobile.offline_floor")}</MutedText>}
          {!stage.recorded && stage.category !== "emergency" && <MutedText>{t("symptom.degraded.not_saved")}</MutedText>}
          <NotADiagnosis />
          <SecondaryButton
            title={t("symptom.mobile.again")}
            onPress={() => {
              setShownEmergency(false);
              setStage({ step: "pick" });
            }}
          />
        </View>
      )}
      {stage.step === "error" && <ErrorText>{t("symptom.mobile.error")}</ErrorText>}
    </Card>
  );
}

function CaptureForm({ complaintKey, busy, onSubmit }: { complaintKey: string; busy: boolean; onSubmit: (c: SymptomCapture) => void }) {
  const colors = useLegacyColors();
  const vocab = SEED_PATHWAYS.find((p) => p.key === complaintKey);
  const [onset, setOnset] = useState<Onset>("gradual");
  const [severity, setSeverity] = useState(5);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const toggle = (list: string[], set: (v: string[]) => void, k: string) => set(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const group = (title: string, keys: readonly string[] | undefined, list: string[], set: (v: string[]) => void) =>
    keys && keys.length > 0 ? (
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{title}</Text>
        {keys.map((k) => (
          <ChoiceChip key={k} title={`${list.includes(k) ? "[x] " : "[ ] "}${SYMPTOM_LABEL(k)}`} onPress={() => toggle(list, set, k)} />
        ))}
      </View>
    ) : null;
  return (
    <ScrollView scrollEnabled={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 12 }}>
      <MutedText>{t("symptom.redflag.intro")}</MutedText>
      <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{t("symptom.mobile.when")}</Text>
      <View style={{ gap: 6 }}>
        {(["sudden", "gradual", "unknown"] as const).map((v) => (
          <ChoiceChip key={v} title={`${onset === v ? "(o) " : "( ) "}${v === "sudden" ? "Suddenly" : v === "gradual" ? "Gradually" : "Not sure"}`} onPress={() => setOnset(v)} />
        ))}
      </View>
      <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{`${t("symptom.mobile.severity")} ${severity}/10`}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <ChoiceChip key={n} title={severity === n ? `[${n}]` : String(n)} onPress={() => setSeverity(n)} />
        ))}
      </View>
      {group(t("symptom.redflag.symptoms"), vocab?.knownAssociatedSymptoms, symptoms, setSymptoms)}
      {group(t("symptom.redflag.triggers"), vocab?.knownTriggers, triggers, setTriggers)}
      {group(t("symptom.redflag.history"), vocab?.knownHistory, history, setHistory)}
      <PrimaryButton
        title={t("symptom.mobile.continue")}
        loading={busy}
        onPress={() =>
          onSubmit({ presentingComplaintKey: complaintKey, onset, severity, associatedSymptoms: symptoms, triggers, relevantHistory: history, measurements: {} })
        }
      />
    </ScrollView>
  );
}
