import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  CARE_OPTIONS,
  PROGRESS_OPTIONS,
  buildSafetyNet,
  type CheckbackAction,
  type CheckbackCare,
  type CheckbackProgress,
  type SymptomCapture,
} from "@tarragon/symptom-triage-engine";
import {
  getOpenSymptomCheckbacks,
  getSymptomCheckback,
  getSymptomCheckerState,
  postSymptomCheckback,
  type SymptomCheckbackView,
  type SymptomCheckerState,
} from "@/lib/api";
import { followUpIsEmergencyOnDevice, followUpResultView, keepEmergency } from "@/lib/symptom-checkback-model";
import { uxFromState } from "@/lib/symptom-ux-model";
import { Card, ChoiceChip, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { useLegacyColors, textStyles } from "@/ui/design";
import { NotADiagnosis } from "@/ui/not-a-diagnosis";
import { SafetyBlock } from "@/screens/sections/symptom-assessment-extras";
import { AppText } from "@/ui/kit/AppText";

/**
 * S59c: the follow-up after a symptom check ("How are you getting on?") on the phone. A quiet banner appears only when one is waiting and the
 * symptom checker is open (any failure shows nothing: a follow-up is never required for anything). Order of events is the safety rule: the
 * red-flag floor is re-run ON THE PHONE on the original answers plus what is newly ticked, an emergency is shown at once, and the server (the
 * web's own code) re-runs it from the stored answers, decides and records. A failed send is told plainly and points to the safe routes; it
 * never reads as "all clear". Plain text, English only, no analytics.
 */
const symptomLabel = (key: string): string => {
  const k = `symptom.opt.${key}`;
  const v = (t as (k: string) => string)(k);
  return !v || v === k ? key.replace(/_/g, " ") : v;
};

export function SymptomCheckbackCard({ actingForSomeoneElse }: { actingForSomeoneElse: boolean }) {
  const [ids, setIds] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (actingForSomeoneElse) return;
    let live = true;
    getOpenSymptomCheckbacks().then((r) => live && setIds(r?.open ? r.checkbacks.map((c) => c.id) : []));
    return () => {
      live = false;
    };
  }, [actingForSomeoneElse]);

  if (actingForSomeoneElse || ids.length === 0) return null;
  if (!openId) {
    return (
      <Card>
        <View accessibilityRole="alert" style={{ gap: 8 }}>
          <AppText variant="bodyLargeStrong" accessibilityRole="header">{t("symptom.checkback.banner")}</AppText>
          <PrimaryButton title={t("symptom.checkback.banner_cta")} onPress={() => setOpenId(ids[0] ?? null)} />
        </View>
      </Card>
    );
  }
  return <CheckbackFlow id={openId} onClose={() => setOpenId(null)} onAnswered={() => setIds((l) => l.filter((x) => x !== openId))} />;
}

function CheckbackFlow({ id, onClose, onAnswered }: { id: string; onClose: () => void; onAnswered: () => void }) {
  const colors = useLegacyColors();
  const [view, setView] = useState<SymptomCheckbackView | null | undefined>(undefined);
  const [state, setState] = useState<SymptomCheckerState | null>(null);
  const [progress, setProgress] = useState<CheckbackProgress | null>(null);
  const [care, setCare] = useState<CheckbackCare | null>(null);
  const [signs, setSigns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<{ action: CheckbackAction; doctorAccess: boolean | null; raised: boolean; recorded: boolean } | null>(null);
  const ux = useMemo(() => uxFromState(state), [state]);

  useEffect(() => {
    let live = true;
    getSymptomCheckback(id).then((r) => live && setView(r?.open ? r.view : null));
    getSymptomCheckerState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [id]);

  if (view === undefined) return null;
  if (view === null || (view.state !== "open" && view.state !== "expired")) {
    return (
      <Card>
        <MutedText>{t("symptom.checkback.gone")}</MutedText>
        <SecondaryButton title={t("symptom.checkback.skip")} onPress={onClose} />
      </Card>
    );
  }
  const v = view;

  async function send() {
    if (!progress) return;
    setBusy(true);
    setFailed(false);
    // 1. the floor, on this phone, on the original answers plus what is newly ticked
    const emergencyShown = followUpIsEmergencyOnDevice(v.capture as SymptomCapture, signs);
    if (emergencyShown) setDone({ action: "emergency", doctorAccess: null, raised: false, recorded: false });
    // 2. the server re-runs it from the stored answers, decides and records
    const r = await postSymptomCheckback({ checkbackId: v.id, progress, care, signs });
    setBusy(false);
    if (r && r.ok) {
      const action = keepEmergency(emergencyShown, r.outcome.action) ?? r.outcome.action;
      setDone({ action, doctorAccess: r.outcome.doctor_access ?? null, raised: r.outcome.alert_raised || r.outcome.emergency, recorded: true });
      onAnswered();
    } else if (!emergencyShown) {
      setFailed(true);
    }
  }

  if (done) {
    const result = followUpResultView(done.action, done.doctorAccess, done.raised);
    const net = buildSafetyNet({ pathwayKey: v.complaint_key, category: result.doorCategory }, ux.safetyNet);
    return (
      <Card>
        <View accessibilityRole="alert" style={{ gap: 10 }}>
          <Text style={{ ...textStyles.bodyLargeStrong, color: done.action === "emergency" ? colors.danger : colors.ink }}>{t(result.messageKey as MessageKey)}</Text>
          {result.told && <MutedText>{t("symptom.checkback.result.told")}</MutedText>}
          {!done.recorded && <MutedText>{t("symptom.checkback.error")}</MutedText>}
          <NotADiagnosis />
          {result.showSafetyNet && <SafetyBlock net={net} />}
          <SecondaryButton title={t("symptom.mobile.again")} onPress={onClose} />
        </View>
      </Card>
    );
  }

  const toggle = (k: string) => setSigns((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <Card>
      <AppText variant="bodyLargeStrong" accessibilityRole="header">{t("symptom.checkback.title")}</AppText>
      <AppText variant="bodyStrong" style={{ marginTop: 4 }}>{v.complaint_label}</AppText>
      <MutedText>{t("symptom.checkback.intro")}</MutedText>
      <View style={{ gap: 6, marginTop: 8 }}>
        <AppText variant="bodyStrong" accessibilityRole="header">{t("symptom.checkback.q_progress")}</AppText>
        {PROGRESS_OPTIONS.map((p) => (
          <ChoiceChip key={p} title={`${progress === p ? "(o) " : "( ) "}${t(`symptom.checkback.progress.${p}` as MessageKey)}`} onPress={() => setProgress(p)} />
        ))}
      </View>
      <View style={{ gap: 6, marginTop: 8 }}>
        <AppText variant="bodyStrong" accessibilityRole="header">{t("symptom.checkback.q_care")}</AppText>
        {CARE_OPTIONS.map((c) => (
          <ChoiceChip key={c} title={`${care === c ? "(o) " : "( ) "}${t(`symptom.checkback.care.${c}` as MessageKey)}`} onPress={() => setCare(c)} />
        ))}
      </View>
      {v.sign_vocabulary.length > 0 && (
        <View style={{ gap: 6, marginTop: 8 }}>
          <AppText variant="bodyStrong" accessibilityRole="header">{t("symptom.checkback.q_signs")}</AppText>
          {v.sign_vocabulary.map((k) => (
            <ChoiceChip key={k} title={`${signs.includes(k) ? "[x] " : "[ ] "}${symptomLabel(k)}`} onPress={() => toggle(k)} />
          ))}
        </View>
      )}
      {failed && <ErrorText>{t("symptom.checkback.error")}</ErrorText>}
      <View style={{ gap: 8, marginTop: 12 }}>
        <PrimaryButton title={t("symptom.checkback.submit")} disabled={!progress} loading={busy} onPress={send} />
        <SecondaryButton title={t("symptom.checkback.skip")} onPress={onClose} />
      </View>
      <NotADiagnosis variant="short" />
    </Card>
  );
}
