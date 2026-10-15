import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HELD_READING_COPY, sourceBadgeLabel } from "@tarragon/shared";
import { loadCachedEmergencyFacts, type EmergencyContact } from "@/lib/emergency";
import { discardHeldReading, loadHeldReadings, type HeldReading } from "@/lib/held-readings";
import { loadRecommendedDevices, type RecommendedDevice } from "@/lib/recommended-devices";
import { loadSevereLowMessage } from "@/lib/cgm-safety";
import { readEcgClassifications, syncEcgResults } from "@/lib/healthkit-ecg";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";

/**
 * The Module 18 sections of the Devices screen (S70a). Each one renders only when its go-live switch is on (the caller decides) and each says
 * so honestly when it cannot load: "nothing is waiting" is never shown for "we could not check".
 */

/** "Please check this reading": a value that cannot be real, waiting for the person (18.9). */
export function HeldReadingsSection({ patientId, onEnterAgain }: { patientId: string; onEnterAgain: () => void }) {
  const colors = useLegacyColors();
  const [state, setState] = useState<{ phase: "loading" } | { phase: "failed" } | { phase: "ok"; items: HeldReading[] }>({ phase: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const result = await loadHeldReadings(patientId);
    setState(result.ok ? { phase: "ok", items: result.items } : { phase: "failed" });
  }, [patientId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "loading") return null;
  if (state.phase === "failed") return <MutedText>We could not check for readings waiting for you. This is not the same as there being none.</MutedText>;
  if (state.items.length === 0) return null;

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{HELD_READING_COPY.title}</Text>
      <MutedText>{HELD_READING_COPY.body}</MutedText>
      {state.items.map((item) => (
        <View key={item.id} style={{ gap: 6 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>
            {item.summary} <Text style={{ fontSize: 12, fontWeight: "500", color: colors.muted }}>{sourceBadgeLabel(item.source)}</Text>
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <PrimaryButton title={HELD_READING_COPY.retry} onPress={onEnterAgain} />
            <SecondaryButton
              title={HELD_READING_COPY.discard}
              loading={busy === item.id}
              onPress={async () => {
                setBusy(item.id);
                setError(false);
                const ok = await discardHeldReading(item.id);
                setBusy(null);
                if (ok) await load();
                else setError(true);
              }}
            />
          </View>
        </View>
      ))}
      {error ? <ErrorText>That did not work. Nothing was changed. Try again.</ErrorText> : null}
      <Text style={{ fontWeight: "600", color: colors.ink }}>If you feel unwell, do not wait for a new reading. Get care now.</Text>
    </Card>
  );
}

/** The severe-low safety message from a glucose sensor, decided on the phone (18.5). Shown at once; it never replaces the care team's task. */
export function CgmSafetySection({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void loadSevereLowMessage(patientId).then(setMessage);
  }, [patientId]);
  if (!message) return null;
  return (
    <Card style={{ gap: 8, borderWidth: 2, borderColor: colors.danger }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Ionicons name="alert-circle" size={22} color={colors.danger} />
        <Text style={{ fontWeight: "700", color: colors.ink }}>Please read this now</Text>
      </View>
      <Text style={{ color: colors.ink, fontSize: 15 }}>{message}</Text>
    </Card>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure monitor",
  weight: "Weight scale",
  blood_glucose: "Glucometer",
  band: "Wearable band",
};

/** Recommended devices (18.2): reviewed, evidenced, never sold. Always says "any other device: type it in". */
export function RecommendedDevicesSection() {
  const colors = useLegacyColors();
  const [state, setState] = useState<{ phase: "loading" } | { phase: "failed" } | { phase: "ok"; items: RecommendedDevice[] }>({ phase: "loading" });
  useEffect(() => {
    void loadRecommendedDevices().then((r) => setState(r.ok ? { phase: "ok", items: r.items } : { phase: "failed" }));
  }, []);

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Recommended devices</SectionLabel>
      <MutedText>Our clinical lead has checked these. Tarragon does not sell them and earns nothing if you buy one.</MutedText>
      {state.phase === "failed" ? <MutedText>We could not load the list just now. You can still type in a reading from any device.</MutedText> : null}
      {state.phase === "ok" && state.items.length === 0 ? <MutedText>We have not published a recommended list yet. You can use any device: type the reading in.</MutedText> : null}
      {state.phase === "ok"
        ? state.items.map((d) => (
            <Card key={d.id} style={{ gap: 4 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>{d.name}</Text>
              <MutedText>{CATEGORY_LABEL[d.category] ?? d.category}{d.vendor ? ` · ${d.vendor}` : ""}</MutedText>
              {d.description ? <MutedText>{d.description}</MutedText> : null}
              {d.validatedSourceUrl ? (
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(d.validatedSourceUrl as string)}>
                  <Text style={{ color: colors.brandPressed, textDecorationLine: "underline" }}>
                    Accuracy evidence: {d.validationBasis === "validatebp" ? "ValidateBP listing" : "published validation study"}
                  </Text>
                </Pressable>
              ) : null}
              {d.nafdacNumber ? <MutedText>NAFDAC number {d.nafdacNumber}</MutedText> : null}
              {d.authorisedDistributor ? <MutedText>Sold by {d.authorisedDistributor}</MutedText> : null}
            </Card>
          ))
        : null}
      <Text style={{ fontWeight: "600", color: colors.ink }}>Any other device: type it in. It reaches your care team in exactly the same way.</Text>
    </View>
  );
}

type Symptom = "chest_pain" | "fainting" | "breathlessness";
const SYMPTOMS: { id: Symptom; label: string }[] = [
  { id: "chest_pain", label: "Chest pain" },
  { id: "fainting", label: "Fainting" },
  { id: "breathlessness", label: "Short of breath" },
];

/**
 * Heart rhythm results from the watch (18.6, iOS). Asks first whether any of three symptoms is happening NOW, because those go to the
 * existing red path, not to this one. The person is only ever shown the fixed sentence the server returns, never a label or a diagnosis.
 */
export function EcgResultsSection({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [selected, setSelected] = useState<Set<Symptom>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState(false);
  const [contact, setContact] = useState<EmergencyContact | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const samples = await readEcgClassifications(new Date(Date.now() - 14 * 24 * 3600_000));
    if (samples === null) {
      setBusy(false);
      setError("We could not read results from your watch on this phone.");
      return;
    }
    if (samples.length === 0) {
      setBusy(false);
      setMessage("No new results from your watch.");
      return;
    }
    const outcome = await syncEcgResults(samples, { patientId: patientId, symptoms: [...selected] });
    setBusy(false);
    if (outcome.failed > 0) setError("Some results could not be sent. Please try again when you have a connection.");
    if (outcome.patientCopy) setMessage(outcome.patientCopy);
    else if (outcome.failed === 0) setMessage("Your results were sent to your care team.");
    if (outcome.redPath) {
      const facts = await loadCachedEmergencyFacts().catch(() => null);
      setContact(facts?.emergencyContact ?? null);
      setGuidance(true);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Heart rhythm results from your watch</SectionLabel>
      <Card style={{ gap: 10 }}>
        <MutedText>Right now, do you have any of these? If you do, you will see emergency guidance first.</MutedText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {SYMPTOMS.map((s) => {
            const on = selected.has(s.id);
            return (
              <Pressable
                key={s.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  })
                }
                style={{ borderRadius: 999, borderWidth: 1, borderColor: on ? colors.danger : colors.border, paddingVertical: 8, paddingHorizontal: 14 }}
              >
                <Text style={{ color: colors.ink, fontWeight: on ? "700" : "500" }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {message ? <Text style={{ color: colors.ink }}>{message}</Text> : null}
        <PrimaryButton title="Check for new results" onPress={() => void check()} loading={busy} />
      </Card>
      <EmergencyGuidanceModal visible={guidance} detail="You told us you have a symptom that needs care now." synced emergencyContact={contact} onDismiss={() => setGuidance(false)} />
    </View>
  );
}
