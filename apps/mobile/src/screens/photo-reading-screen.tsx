import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HELD_READING_COPY, type PhotoDeviceKind, type PhotoDraft, type PhotoField } from "@tarragon/shared";
import { postPhotoReading } from "@/lib/api";
import { enqueuePhotoReading } from "@/lib/offline-queue";
import { buildPhotoRequest, draftFromPhoto, finalisePhotoReading, hasTextRecogniser, takeDevicePhoto } from "@/lib/photo-capture";
import { loadReadingSubjects, type ReadingSubject } from "@/lib/reading-subject";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

/**
 * Photo reading capture (S70a, 18.3). The person photographs ANY device screen, then checks every number against the device and ticks it. Only
 * the confirmed numbers are sent; the photo stays on this phone and is dropped when the screen closes. Nothing is saved until every number
 * is ticked. An impossible number is not saved: the person is asked to check the device or the number and enter it again. A saved reading is
 * triaged exactly like a typed one.
 *
 * With no text recogniser in this build the boxes start empty and the person types what they see, with their photo shown above to help.
 */
interface Props {
  userId: string;
  onClose: () => void;
}

const KINDS: { kind: PhotoDeviceKind; label: string }[] = [
  { kind: "blood_pressure", label: "Blood pressure" },
  { kind: "glucose", label: "Blood sugar" },
  { kind: "weight", label: "Weight" },
  { kind: "temperature", label: "Temperature" },
  { kind: "spo2", label: "Oxygen level" },
];

const FIELD_LABEL: Record<PhotoField["field"], string> = {
  systolic: "Top number (systolic)",
  diastolic: "Bottom number (diastolic)",
  pulse_bpm: "Pulse (if shown)",
  glucose_value: "Blood sugar",
  weight_value: "Weight",
  temperature_c: "Temperature",
  spo2_pct: "Oxygen level (%)",
};

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brandTintAlt : colors.card,
      }}
    >
      <Text style={{ color: colors.ink, fontSize: 13, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

type Phase = "choose" | "draft" | "saving" | "saved" | "queued" | "held";

export function PhotoReadingScreen({ userId, onClose }: Props) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [subjects, setSubjects] = useState<ReadingSubject[]>([{ profileId: userId, label: "Mine", isSelf: true }]);
  const [subjectId, setSubjectId] = useState(userId);
  const [kind, setKind] = useState<PhotoDeviceKind>("blood_pressure");
  const [phase, setPhase] = useState<Phase>("choose");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<Date>(new Date());
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [edits, setEdits] = useState<Partial<Record<PhotoField["field"], string>>>({});
  const [ticked, setTicked] = useState<Set<PhotoField["field"]>>(new Set());
  const [unit, setUnit] = useState<PhotoDraft["unit"]>(null);
  const [glucoseContext, setGlucoseContext] = useState<"fasting" | "random" | "post_meal" | undefined>(undefined);
  const [cuffType, setCuffType] = useState<"upper_arm" | "wrist" | "not_sure" | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [heldReasons, setHeldReasons] = useState(false);

  useEffect(() => {
    void loadReadingSubjects(userId).then(setSubjects);
  }, [userId]);

  const allTicked = useMemo(() => (draft ? draft.fields.every((f) => ticked.has(f.field) || (f.field === "pulse_bpm" && (edits.pulse_bpm ?? f.value).trim() === "")) : false), [draft, ticked, edits]);

  async function takePhoto() {
    setError(null);
    const taken = await takeDevicePhoto();
    if (!taken.ok) {
      setError(taken.reason === "denied" ? "To photograph a device, allow the camera in your phone settings. You can also type the reading in from the Vitals tab." : taken.reason === "cancelled" ? "No photo was taken." : "The camera is not available right now. You can type the reading in from the Vitals tab.");
      return;
    }
    const next = await draftFromPhoto(kind, taken.uri);
    setPhotoUri(taken.uri);
    setTakenAt(new Date());
    setDraft(next);
    setUnit(next.unit);
    setEdits({});
    setTicked(new Set());
    setPhase("draft");
  }

  async function save() {
    if (!draft) return;
    setError(null);
    const confirmInput = { draft, edits, confirmedFields: [...ticked], unit, glucoseContext, cuffType };
    const done = finalisePhotoReading(confirmInput);
    if (!done.ok) {
      setError(done.error);
      return;
    }
    setNotes(done.notes);
    if (done.held) {
      // Impossible: not saved, not sent. The person is asked to check the device or the number.
      setHeldReasons(true);
      setPhase("held");
      return;
    }
    setPhase("saving");
    const request = buildPhotoRequest(done.reading, takenAt, subjectId === userId ? undefined : subjectId);
    const sent = await postPhotoReading(request);
    if (sent.ok) {
      setPhase(sent.held ? "held" : "saved");
      if (sent.held) setHeldReasons(true);
      return;
    }
    if (sent.offline || (sent.status !== undefined && sent.status >= 500)) {
      // Kept on the phone as numbers only; sent when the phone is back online (offline-queue.ts).
      const queued = await enqueuePhotoReading(request);
      if (queued) setPhase("queued");
      else {
        setError("We could not save this reading. Please try again.");
        setPhase("draft");
      }
      return;
    }
    setError(sent.error);
    setPhase("draft");
  }

  const input = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 20,
    fontWeight: "700" as const,
    color: colors.ink,
    backgroundColor: colors.card,
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <ScreenTitle>Photograph a device screen</ScreenTitle>

      {phase === "choose" && (
        <>
          <MutedText>Take a clear photo of the screen. The photo stays on this phone. You will check every number before anything is saved.</MutedText>
          {subjects.length > 1 && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>Whose reading is this?</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {subjects.map((s) => (
                  <Option key={s.profileId} label={s.label} selected={subjectId === s.profileId} onPress={() => setSubjectId(s.profileId)} />
                ))}
              </View>
            </View>
          )}
          <View style={{ gap: 8 }}>
            <Text style={{ fontWeight: "700", color: colors.ink }}>What does the device measure?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {KINDS.map((k) => (
                <Option key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
              ))}
            </View>
          </View>
          {!hasTextRecogniser() && <MutedText>This version cannot read numbers from a photo yet. Your photo is shown to help you type what you see.</MutedText>}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title="Take a photo" onPress={() => void takePhoto()} />
        </>
      )}

      {(phase === "draft" || phase === "saving") && draft && (
        <>
          {photoUri ? <Image source={{ uri: photoUri }} accessibilityLabel="Your photo of the device screen" style={{ width: "100%", height: 200, borderRadius: radius.control, backgroundColor: colors.groupBg }} resizeMode="contain" /> : null}
          <MutedText>Check each number against your device, then tick it.</MutedText>
          {draft.warnings.map((w) => (
            <ErrorText key={w}>{w}</ErrorText>
          ))}
          {draft.fields.map((f) => (
            <Card key={f.field} style={{ gap: 8 }}>
              <Text style={{ fontWeight: "600", color: colors.ink }}>{FIELD_LABEL[f.field]}</Text>
              <TextInput
                keyboardAppearance={scheme}
                keyboardType="decimal-pad"
                value={edits[f.field] ?? f.value}
                onChangeText={(v) => {
                  setEdits((prev) => ({ ...prev, [f.field]: v }));
                  // Changing a number un-ticks it: a changed number must be checked again.
                  setTicked((prev) => {
                    const next = new Set(prev);
                    next.delete(f.field);
                    return next;
                  });
                }}
                accessibilityLabel={FIELD_LABEL[f.field]}
                style={input}
              />
              {f.suggested ? <MutedText>Read from your photo. It can be wrong, please check it.</MutedText> : null}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ticked.has(f.field) }}
                onPress={() =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(f.field)) next.delete(f.field);
                    else next.add(f.field);
                    return next;
                  })
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Ionicons name={ticked.has(f.field) ? "checkbox" : "square-outline"} size={24} color={ticked.has(f.field) ? colors.brand : colors.muted} />
                <Text style={{ color: colors.ink }}>I checked this number</Text>
              </Pressable>
            </Card>
          ))}
          {draft.needsUnit && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>Which unit does your device show?</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {(kind === "glucose" ? [["mmol_l", "mmol/L"], ["mg_dl", "mg/dL"]] : kind === "weight" ? [["kg", "kg"], ["lb", "lb"]] : [["c", "°C"], ["f", "°F"]]).map(([value, label]) => (
                  <Option key={value} label={label as string} selected={unit === value} onPress={() => setUnit(value as PhotoDraft["unit"])} />
                ))}
              </View>
            </View>
          )}
          {kind === "glucose" && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>When did you take it?</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {([["fasting", "Fasting"], ["random", "Random"], ["post_meal", "After a meal"]] as const).map(([v, label]) => (
                  <Option key={v} label={label} selected={glucoseContext === v} onPress={() => setGlucoseContext(v)} />
                ))}
              </View>
            </View>
          )}
          {kind === "blood_pressure" && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>Which cuff?</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {([["upper_arm", "Upper arm"], ["wrist", "Wrist"], ["not_sure", "Not sure"]] as const).map(([v, label]) => (
                  <Option key={v} label={label} selected={cuffType === v} onPress={() => setCuffType(v)} />
                ))}
              </View>
              {cuffType === "wrist" && <MutedText>Wrist cuffs can be less reliable. An upper-arm cuff gives a steadier reading.</MutedText>}
            </View>
          )}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {phase === "saving" ? <ActivityIndicator color={colors.brand} /> : <PrimaryButton title="Save this reading" onPress={() => void save()} disabled={!allTicked} />}
          <SecondaryButton title="Take the photo again" onPress={() => setPhase("choose")} disabled={phase === "saving"} />
        </>
      )}

      {phase === "saved" && (
        <Card style={{ gap: 8, alignItems: "center" }}>
          <Ionicons name="checkmark-circle" size={28} color={colors.success} />
          <Text style={{ fontWeight: "700", color: colors.ink }}>Saved. Your care team sees it like any other reading.</Text>
          {notes.map((n) => (
            <MutedText key={n}>{n}</MutedText>
          ))}
        </Card>
      )}
      {phase === "queued" && (
        <Card style={{ gap: 8, alignItems: "center" }}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.muted} />
          <Text style={{ fontWeight: "700", color: colors.ink }}>Saved on this phone. It will be sent when you are back online.</Text>
        </Card>
      )}
      {phase === "held" && heldReasons && (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{HELD_READING_COPY.title}</Text>
          <MutedText>{HELD_READING_COPY.body}</MutedText>
          <Text style={{ fontWeight: "600", color: colors.ink }}>If you feel unwell, do not wait for a new reading. Get care now.</Text>
          <PrimaryButton title={HELD_READING_COPY.retry} onPress={() => { setHeldReasons(false); setPhase("draft"); }} />
        </Card>
      )}

      <SecondaryButton title={phase === "saved" || phase === "queued" ? "Done" : "Close"} onPress={onClose} />
    </ScrollView>
  );
}
