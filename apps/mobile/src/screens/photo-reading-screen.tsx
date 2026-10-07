import { useEffect, useMemo, useState } from "react";
import { Image, Modal, ScrollView, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  cuffReliabilityNote,
  getProposedConfig,
  parseDeviceScreenText,
  type CuffType,
  type ParsedScreenReading,
  type PhotoReadingKind,
} from "@tarragon/shared";
import { logPhotoVital } from "@/lib/vitals";
import { loadCachedEmergencyFacts, type EmergencyContact } from "@/lib/emergency";
import { classifyVitalOffline } from "@/lib/vitals";
import { buildPhotoPayload } from "@/lib/photo-reading/payload";
import { recognizeScreenText } from "@/lib/photo-reading/recognizer";
import type { GlucoseUnit } from "@/lib/vitals-entry";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import { space } from "@/ui/design";
import { AppText, Button, Card, Chip, Field, InlineAlert, SegmentedControl, useToast } from "@/ui/kit";

/**
 * S70 (18.3): enter a reading by photographing a device's screen.
 *
 * The photo is shown beside editable fields and never leaves the phone. If a text recogniser is installed in the build it
 * prefills the fields (marked as suggestions); today none is (see lib/photo-reading/recognizer.ts), so the patient types
 * what they see. Either way the patient ticks that the numbers match the screen before anything is saved, and the saved
 * reading takes the manual path: the same bounds, the same on-device emergency check, the same server triage (INV-01).
 * The photo is a convenience. A device is never required, and typing a reading in elsewhere always works.
 */
const KINDS: { id: PhotoReadingKind; labelKey: MessageKey }[] = [
  { id: "blood_pressure", labelKey: "devices.photo.type.blood_pressure" },
  { id: "glucose", labelKey: "vitals.type.glucose" },
  { id: "weight", labelKey: "vitals.type.weight" },
  { id: "temperature", labelKey: "vitals.type.temperature" },
  { id: "spo2", labelKey: "vitals.type.spo2" },
  { id: "pulse", labelKey: "vitals.type.pulse" },
];
const UNIT: Record<Exclude<PhotoReadingKind, "blood_pressure">, string> = { glucose: "mmol/L", weight: "kg", temperature: "°C", spo2: "%", pulse: "bpm" };

interface Props {
  visible: boolean;
  beneficiaryProfileId?: string;
  onClose: () => void;
}

export function PhotoReadingScreen({ visible, beneficiaryProfileId, onClose }: Props) {
  const toast = useToast();
  const photoConfig = getProposedConfig<{ less_reliable_cuff_types: string[] }>("devices.photo_capture").value;
  const [kind, setKind] = useState<PhotoReadingKind>("blood_pressure");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraOff, setCameraOff] = useState(false);
  const [suggested, setSuggested] = useState<ParsedScreenReading | null>(null);
  const [triedRead, setTriedRead] = useState(false);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [value, setValue] = useState("");
  const [glucoseUnit, setGlucoseUnit] = useState<GlucoseUnit>("mmol_l");
  const [cuffType, setCuffType] = useState<CuffType | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guidance, setGuidance] = useState<{ detail: string; synced: boolean } | null>(null);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact | null>(null);

  useEffect(() => {
    if (!visible) return;
    loadCachedEmergencyFacts()
      .then((facts) => setEmergencyContact(facts?.emergencyContact ?? null))
      .catch(() => {});
  }, [visible]);

  const note = useMemo(
    () => (kind === "blood_pressure" ? cuffReliabilityNote(cuffType, photoConfig.less_reliable_cuff_types) : null),
    [kind, cuffType, photoConfig.less_reliable_cuff_types]
  );

  function reset(nextKind: PhotoReadingKind) {
    setKind(nextKind);
    setPhotoUri(null);
    setSuggested(null);
    setTriedRead(false);
    setSystolic("");
    setDiastolic("");
    setValue("");
    setConfirmed(false);
    setErrorKey(null);
    setSaveError(null);
  }

  async function takePhoto() {
    setCameraOff(false);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setCameraOff(true);
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
      if (shot.canceled || !shot.assets[0]) return;
      const uri = shot.assets[0].uri;
      setPhotoUri(uri);
      setConfirmed(false);
      setTriedRead(false);
      const outcome = await recognizeScreenText(uri);
      setTriedRead(true);
      if (outcome.kind === "text") {
        const parsed = parseDeviceScreenText(outcome.lines, kind);
        setSuggested(parsed);
        if (kind === "blood_pressure") {
          if (parsed.fields.systolic !== undefined) setSystolic(String(parsed.fields.systolic));
          if (parsed.fields.diastolic !== undefined) setDiastolic(String(parsed.fields.diastolic));
        } else if (parsed.fields.value !== undefined) {
          setValue(String(parsed.fields.value));
          if (kind === "glucose" && parsed.glucoseUnit) setGlucoseUnit(parsed.glucoseUnit);
        }
      } else {
        setSuggested(null);
      }
    } catch {
      setCameraOff(true);
    }
  }

  async function save() {
    const built = buildPhotoPayload({
      kind,
      systolic,
      diastolic,
      pulse: "",
      value,
      glucoseUnit,
      glucoseContext: "random",
      cuffType,
      confirmedMatches: confirmed,
    });
    if (!built.ok) {
      setSaveError(null);
      setErrorKey(
        (built.error === "not_confirmed"
          ? "devices.photo.need_confirm"
          : built.error === "numbers"
            ? "devices.photo.error.numbers"
            : built.error === "order"
              ? "devices.photo.error.order"
              : built.error === "value_range"
                ? "devices.photo.error.value_range"
                : "devices.photo.error.range") as MessageKey
      );
      return;
    }
    setSaving(true);
    setErrorKey(null);
    setSaveError(null);
    // The same on-device emergency check a typed reading gets, before the network.
    const flag = await classifyVitalOffline(built.payload).catch(() => null);
    if (flag?.severity === "emergency") setGuidance({ detail: flag.detail, synced: false });
    const result = await logPhotoVital(built.payload, beneficiaryProfileId);
    setSaving(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    if (flag?.severity === "emergency") setGuidance({ detail: flag.detail, synced: !!result.synced });
    toast.show({ message: t("devices.photo.saved"), tone: "success" });
    reset(kind);
    if (flag?.severity !== "emergency") onClose();
  }

  const unitLabel = kind === "blood_pressure" ? "mmHg" : kind === "glucose" ? (glucoseUnit === "mmol_l" ? "mmol/L" : "mg/dL") : UNIT[kind];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        <AppText variant="title" heading>
          {t("devices.photo.title")}
        </AppText>
        <AppText>{t("devices.photo.intro")}</AppText>

        <AppText variant="label">{t("devices.photo.type_group")}</AppText>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {KINDS.map((k) => (
            <Chip key={k.id} label={t(k.labelKey)} selected={kind === k.id} onPress={() => reset(k.id)} />
          ))}
        </View>

        <Button title={photoUri ? t("devices.photo.retake") : t("devices.photo.take")} onPress={takePhoto} />
        {cameraOff ? <InlineAlert tone="warn" message={t("devices.photo.camera_off")} /> : null}

        {photoUri ? (
          <Card style={{ gap: space.sm }}>
            <Image source={{ uri: photoUri }} accessibilityLabel={t("devices.photo.title")} style={{ width: "100%", height: 220, borderRadius: 8 }} resizeMode="contain" />
            {triedRead && !suggested ? <InlineAlert tone="info" message={t("devices.photo.not_read")} /> : null}
            {suggested && suggested.confidence !== "none" ? <InlineAlert tone="info" message={t("devices.photo.suggested")} /> : null}
          </Card>
        ) : null}

        <Card style={{ gap: space.md }}>
          {kind === "blood_pressure" ? (
            <>
              <Field label={t("devices.photo.field.systolic")} keyboardType="number-pad" value={systolic} onChangeText={setSystolic} />
              <Field label={t("devices.photo.field.diastolic")} keyboardType="number-pad" value={diastolic} onChangeText={setDiastolic} />
              <AppText variant="label">{t("devices.photo.cuff_group")}</AppText>
              <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: space.sm }}>
                {(["upper_arm", "wrist", "not_sure"] as CuffType[]).map((c) => (
                  <Chip key={c} label={t(`devices.photo.cuff.${c}` as MessageKey)} selected={cuffType === c} onPress={() => setCuffType(c)} />
                ))}
              </View>
              {note === "less_reliable" ? <InlineAlert tone="info" message={t("devices.photo.wrist_note")} /> : null}
              {note === "prefer_upper_arm" ? <InlineAlert tone="info" message={t("devices.photo.upper_arm_hint")} /> : null}
            </>
          ) : (
            <>
              <Field label={t("devices.photo.field.value", "en", { unit: unitLabel })} keyboardType="decimal-pad" value={value} onChangeText={setValue} />
              {kind === "glucose" ? (
                <SegmentedControl
                  accessibilityLabel="Glucose unit"
                  value={glucoseUnit}
                  onChange={setGlucoseUnit}
                  options={[
                    { value: "mmol_l" as GlucoseUnit, label: "mmol/L" },
                    { value: "mg_dl" as GlucoseUnit, label: "mg/dL" },
                  ]}
                />
              ) : null}
            </>
          )}

          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Switch value={confirmed} onValueChange={setConfirmed} accessibilityLabel={t("devices.photo.confirm")} />
            <AppText style={{ flexShrink: 1 }}>{t("devices.photo.confirm")}</AppText>
          </View>
          {errorKey ? <InlineAlert tone="danger" message={t(errorKey)} /> : null}
          {saveError ? <InlineAlert tone="danger" message={saveError} /> : null}
          <Button title={t("devices.photo.save")} onPress={save} loading={saving} />
          <Button title="Close" variant="secondary" onPress={onClose} />
        </Card>
      </ScrollView>

      <EmergencyGuidanceModal
        visible={guidance !== null}
        detail={guidance?.detail ?? ""}
        synced={guidance?.synced ?? false}
        emergencyContact={emergencyContact}
        onDismiss={() => {
          setGuidance(null);
          onClose();
        }}
      />
    </Modal>
  );
}
