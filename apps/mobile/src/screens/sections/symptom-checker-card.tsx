import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import {
  SEED_PATHWAYS,
  type AnsweredQuestion,
  type Onset,
  type SymptomCapture,
  type TriageCategory,
} from "@tarragon/symptom-triage-engine";
import { getSymptomCheckerState, postDescribeDanger, postSymptomStep, type SymptomCheckerState, type SymptomStepResponse } from "@/lib/api";
import { categoryMessageKey, keepMoreUrgent, offlineResult, viewFor } from "@/lib/symptom-check-model";
import { screenRedFlagsOnDevice } from "@/lib/symptom-red-flags";
import { newDescribeSessionKey, phoneExtras, uxFromState } from "@/lib/symptom-ux-model";
import { Card, ChoiceChip, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { useLegacyColors } from "@/ui/design";
import { NotADiagnosis } from "@/ui/not-a-diagnosis";
import { DescribeBox, SafetyBlock, SaveCard, WhyBlock } from "@/screens/sections/symptom-assessment-extras";
import { AppText } from "@/ui/kit/AppText";

/**
 * S59b: the mobile symptom checker (English only, text first). Order of events is the safety rule (spec 12.8, INV-06):
 *   1. the red-flag floor runs ON THE PHONE from the bundled rules the moment the checklist is submitted, and an emergency is shown
 *      at once, whatever the server does or does not answer;
 *   2. the question walk and the recording go through the bearer-authenticated /api/mobile/symptom-check, which is the web's own code;
 *   3. if the server cannot be reached, the phone shows "needs prompt attention", never "all clear".
 * Behind the symptom_checker_enabled guard and FAILS CLOSED (no answer from the server reads as closed). Under 18, or no date of birth,
 * gets a calm block. No analytics SDK is used anywhere here.
 *
 * S59c adds, in the same order of events: a "describe it" box whose words go through the shared danger-phrase screen FIRST (on the phone,
 * then thrown away; they are never stored, logged or sent), a "Why this result" section and the safety-net lines (each only from a config the
 * CMO has signed; a draft shows nothing extra but the generic safety net), and a plain-text "Save this card" with a "Clear this screen"
 * button for a shared phone. The describe box is a plain TextInput, so the phone keyboard's own dictation works (no voice code of ours,
 * no server speech-to-text).
 */
type Stage =
  | { step: "pick" }
  | { step: "capture"; complaintKey: string }
  | { step: "question"; question: Extract<SymptomStepResponse, { status: "in_progress" }>["question"]; capture: SymptomCapture; answers: Record<string, boolean | string>; questionLog: Extract<SymptomStepResponse, { status: "in_progress" }>["state"]["questionLog"] }
  | {
      step: "result";
      category: string;
      onDevice: boolean;
      degraded: boolean;
      recorded: boolean;
      /** S59c: what the explanation, the safety net and the card are built from. Ids and the person's own answers only. */
      safetyNetMessageKey: string;
      complaintKey: string;
      capture: SymptomCapture | null;
      firedRuleKeys: string[];
      tightenedBy: string[];
      questionsAsked: AnsweredQuestion[];
      checkedAt: string;
    }
  | { step: "blocked"; reason: "under_18" | "dob_required" }
  | { step: "error" };

type ResultStage = Extract<Stage, { step: "result" }>;

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
  const [describeDanger, setDescribeDanger] = useState<{ selfHarm: boolean } | null>(null);
  const [describeSession] = useState(() => newDescribeSessionKey());
  const [describeRecorded, setDescribeRecorded] = useState<"none" | "paged" | "recorded_only">("none");
  const [cleared, setCleared] = useState(false);
  const ux = useMemo(() => uxFromState(state), [state]);

  useEffect(() => {
    let live = true;
    getSymptomCheckerState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);

  const finish = useCallback(
    (r: SymptomStepResponse | null, capture: SymptomCapture) => {
      const base = { complaintKey: capture.presentingComplaintKey, capture, checkedAt: new Date().toISOString() };
      if (r === null || r.status === "unavailable" || r.status === "error") {
        const off = offlineResult(capture);
        const floor = screenRedFlagsOnDevice(capture);
        setStage({ step: "result", category: keepMoreUrgent(shownEmergency, off.category), onDevice: true, degraded: true, recorded: false, safetyNetMessageKey: "degraded.engine_unavailable", firedRuleKeys: floor.fired, tightenedBy: [], questionsAsked: [], ...base });
      } else if (r.status === "blocked") {
        setStage({ step: "blocked", reason: r.reason });
      } else if (r.status === "in_progress") {
        setStage({ step: "question", question: r.question, capture: r.state.capture as unknown as SymptomCapture, answers: r.state.answers, questionLog: r.state.questionLog });
      } else {
        setStage({
          step: "result",
          category: keepMoreUrgent(shownEmergency, r.category),
          onDevice: false,
          degraded: r.degraded,
          recorded: r.recorded,
          safetyNetMessageKey: r.safetyNetMessageKey,
          firedRuleKeys: r.firedRuleKeys ?? [],
          tightenedBy: r.tightenedBy ?? [],
          questionsAsked: r.questionsAsked ?? [],
          ...base,
        });
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
        <AppText variant="bodyLargeStrong" accessibilityRole="header">{t("symptom.mobile.title")}</AppText>
        <MutedText>{t("symptom.mobile.closed")}</MutedText>
      </Card>
    );
  }
  if (view.kind === "blocked" || stage.step === "blocked") {
    const reason = view.kind === "blocked" ? view.reason : (stage as Extract<Stage, { step: "blocked" }>).reason;
    return (
      <Card>
        <AppText variant="bodyLargeStrong" accessibilityRole="header">{t("symptom.mobile.title")}</AppText>
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
      setStage({
        step: "result",
        category: "emergency",
        onDevice: true,
        degraded: false,
        recorded: false,
        safetyNetMessageKey: `redflag.${floor.fired[0] ?? "unknown"}`,
        complaintKey: capture.presentingComplaintKey,
        capture,
        firedRuleKeys: floor.fired,
        tightenedBy: [],
        questionsAsked: [],
        checkedAt: new Date().toISOString(),
      });
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

  /** S59c: the person's own words contained danger wording. Emergency guidance at once, on this phone. The words are already gone. */
  function describeFoundDanger(selfHarm: boolean) {
    setShownEmergency(true);
    setDescribeDanger({ selfHarm });
    setDescribeRecorded("none");
    // the guidance is already on screen; this only tells the care team the FACT (a coarse code, never the words) and never blocks anything
    postDescribeDanger({ session: describeSession, category: selfHarm ? "self_harm" : "danger" })
      .then((r) => setDescribeRecorded(r.recorded ? (r.doctorAlerted ? "paged" : "recorded_only") : "none"))
      .catch(() => setDescribeRecorded("none"));
    setCleared(false);
    setStage({
      step: "result",
      category: "emergency",
      onDevice: true,
      degraded: false,
      recorded: false,
      safetyNetMessageKey: "describe.danger",
      complaintKey: "",
      capture: null,
      firedRuleKeys: [],
      tightenedBy: [],
      questionsAsked: [],
      checkedAt: new Date().toISOString(),
    });
  }

  function chooseFromDescribe(key: string) {
    setCleared(false);
    setStage({ step: "capture", complaintKey: key });
  }

  /** Shared-phone safety: forget the result, the card and anything typed. Nothing was ever stored. */
  function clearScreen() {
    setShownEmergency(false);
    setDescribeDanger(null);
    setCleared(true);
    setStage({ step: "pick" });
  }

  function extrasFor(r: ResultStage) {
    const category = (["emergency", "urgent", "routine", "self_management"].includes(r.category) ? r.category : "urgent") as TriageCategory;
    const bundledPathway = r.onDevice || complaints.find((c) => c.key === r.complaintKey)?.bundledCurrent === true;
    return phoneExtras(
      {
        category,
        complaintKey: r.complaintKey,
        complaintLabel: complaints.find((c) => c.key === r.complaintKey)?.label ?? null,
        headline: t(categoryMessageKey(r.category)),
        nextStep: null,
        checkedAt: r.checkedAt,
        capture: r.capture,
        firedRuleKeys: r.firedRuleKeys,
        safetyNetMessageKey: r.safetyNetMessageKey,
        tightenedBy: r.tightenedBy,
        questionsAsked: r.questionsAsked,
        bundledPathway,
      },
      ux,
    );
  }

  return (
    <Card>
      <AppText variant="bodyLargeStrong" accessibilityRole="header">{t("symptom.mobile.title")}</AppText>
      {stage.step === "pick" && (
        <View style={{ gap: 8, marginTop: 8 }}>
          {cleared && (
            <View accessibilityRole="alert">
              <MutedText>{t("symptom.card.cleared")}</MutedText>
            </View>
          )}
          <MutedText>{t("symptom.mobile.pick")}</MutedText>
          {complaints.map((c) => (
            <ChoiceChip
              key={c.key}
              title={c.label}
              onPress={() => {
                setCleared(false);
                setStage({ step: "capture", complaintKey: c.key });
              }}
            />
          ))}
          {/* S59c: shown only when the synonym table is signed and matches the live one; an unsigned table leaves the checker exactly as it was. */}
          {ux.describe && <DescribeBox complaints={complaints.map((c) => ({ key: c.key, label: c.label }))} ux={ux} onChoose={chooseFromDescribe} onDanger={describeFoundDanger} />}
        </View>
      )}
      {stage.step === "capture" && <CaptureForm complaintKey={stage.complaintKey} busy={busy} onSubmit={submitCapture} />}
      {stage.step === "question" && (
        <View style={{ gap: 10, marginTop: 8 }}>
          <AppText variant="bodyLargeStrong" accessibilityRole="header">{stage.question.prompt}</AppText>
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
          {describeDanger?.selfHarm && <MutedText>{t("symptom.describe.selfharm")}</MutedText>}
          {describeDanger && describeRecorded === "paged" && <MutedText>{t("symptom.describe.notified")}</MutedText>}
          {describeDanger && describeRecorded === "recorded_only" && <MutedText>{t("symptom.describe.saved_only")}</MutedText>}
          {stage.onDevice && <MutedText>{t("symptom.mobile.offline_floor")}</MutedText>}
          {!stage.recorded && stage.category !== "emergency" && <MutedText>{t("symptom.degraded.not_saved")}</MutedText>}
          <NotADiagnosis />
          {(() => {
            const extras = extrasFor(stage);
            return (
              <>
                {extras.explanation && <WhyBlock explanation={extras.explanation} />}
                {stage.category !== "emergency" && <SafetyBlock net={extras.net} />}
                <SaveCard text={extras.card} onClear={clearScreen} />
              </>
            );
          })()}
          <SecondaryButton
            title={t("symptom.mobile.again")}
            onPress={() => {
              setShownEmergency(false);
              setDescribeDanger(null);
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
        <AppText variant="bodyStrong" accessibilityRole="header">{title}</AppText>
        {keys.map((k) => (
          <ChoiceChip key={k} title={`${list.includes(k) ? "[x] " : "[ ] "}${SYMPTOM_LABEL(k)}`} onPress={() => toggle(list, set, k)} />
        ))}
      </View>
    ) : null;
  return (
    <ScrollView scrollEnabled={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 12 }}>
      <MutedText>{t("symptom.redflag.intro")}</MutedText>
      <AppText variant="bodyStrong" accessibilityRole="header">{t("symptom.mobile.when")}</AppText>
      <View style={{ gap: 6 }}>
        {(["sudden", "gradual", "unknown"] as const).map((v) => (
          <ChoiceChip key={v} title={`${onset === v ? "(o) " : "( ) "}${v === "sudden" ? "Suddenly" : v === "gradual" ? "Gradually" : "Not sure"}`} onPress={() => setOnset(v)} />
        ))}
      </View>
      <AppText variant="bodyStrong" accessibilityRole="header">{`${t("symptom.mobile.severity")} ${severity}/10`}</AppText>
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
