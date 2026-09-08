import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  DANGER_SIGNS,
  DANGER_SIGN_LABEL,
  SYMPTOM_TYPES,
  SYMPTOM_LABEL,
  dangerSignsSummary,
  loadSymptomHistory,
  logSymptom,
  reportDangerSymptoms,
  symptomLabel,
  type AdultSymptomType,
  type DangerSign,
  type SymptomLog,
} from "@/lib/symptoms";
import { loadPatientState } from "@/lib/vitals";
import { loadCachedEmergencyFacts, type EmergencyContact } from "@/lib/emergency";
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, GroupedList, GroupedListRow, MutedText, PrimaryButton, SectionLabel } from "@/ui/components";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";

interface SymptomScreenProps {
  patientId: string;
  /** Set when the signed-in user currently has this patient's account open
   * (lib/acting.ts) — passed through to symptoms.ts's write functions so a
   * report is attributed to the beneficiary, not the caller. Undefined when
   * logging for yourself. Mirrors vitals-screen.tsx's VitalsScreenProps. */
  beneficiaryProfileId?: string;
}

const SEVERITY_SCALE = Array.from({ length: 10 }, (_, i) => i + 1);

function severityChipColor(severity: number): string {
  if (severity >= 8) return colors.status.critical;
  if (severity >= 6) return colors.status.warn;
  return colors.brand;
}

/**
 * Native "Symptoms" screen (MOBILE_APP_SPEC.md §2.2's WebView-embedded
 * symptom logging, replaced with real native UI + real Supabase writes per
 * the founder's WebView-elimination effort). Three pieces, matching the real
 * web feature it replaces (apps/web/src/app/(dashboard)/patient/(sections)/
 * vitals/page.tsx): the one-touch danger-symptom check
 * (danger-symptom-check.tsx), the symptom log form (symptom-log-form.tsx),
 * and symptom history (symptom-log-history.tsx).
 *
 * Deliberately does NOT port SymptomTriageCheck (the dynamic, protocol-driven
 * question-tree wizard backed by @tarragon/symptom-triage-engine and
 * stepSymptomTriage's server action) — that's a materially larger, separate
 * feature (a signed clinical protocol drives an arbitrary-length adaptive
 * question tree server-side) that was not in this change's brief, and the
 * task's own web read confirmed there is no "out-of-range vitals crosscheck"
 * on a symptom log to port either — logSymptom's real implementation
 * (actions.ts) never reads vitals_readings at all, so building one here
 * would be inventing a feature, not porting one.
 */
export function SymptomScreen({ patientId, beneficiaryProfileId }: SymptomScreenProps) {
  const [history, setHistory] = useState<SymptomLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [dangerSelected, setDangerSelected] = useState<Set<DangerSign>>(new Set());
  const [dangerSaving, setDangerSaving] = useState(false);
  const [dangerError, setDangerError] = useState<string | null>(null);

  const [symptomType, setSymptomType] = useState<AdultSymptomType>("other");
  const [severity, setSeverity] = useState(5);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const [guidance, setGuidance] = useState<{ detail: string; synced: boolean } | null>(null);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact | null>(null);
  const [patientState, setPatientState] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    const result = await loadSymptomHistory(patientId);
    if (result.ok) {
      setHistory(result.data);
      setHistoryError(null);
    } else {
      setHistoryError(result.error);
    }
  }, [patientId]);

  useEffect(() => {
    refreshHistory()
      .catch(() => setHistoryError("Couldn't load your symptom history."))
      .finally(() => setHistoryLoading(false));
    loadCachedEmergencyFacts()
      .then((facts) => setEmergencyContact(facts?.emergencyContact ?? null))
      .catch(() => {});
    loadPatientState(patientId).then(setPatientState);
  }, [refreshHistory, patientId]);

  function toggleDangerSign(sign: DangerSign) {
    setDangerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sign)) next.delete(sign);
      else next.add(sign);
      return next;
    });
  }

  async function handleDangerSubmit() {
    const signs = [...dangerSelected];
    if (signs.length === 0) {
      setDangerError("Select at least one sign");
      return;
    }
    setDangerSaving(true);
    setDangerError(null);
    const result = await reportDangerSymptoms(patientId, signs, beneficiaryProfileId);
    setDangerSaving(false);
    if (result.error) {
      setDangerError(result.error);
      return;
    }
    // Reporting a danger sign is never queued offline — it either reaches
    // the server or the request above failed — so synced is always true here.
    setGuidance({ detail: dangerSignsSummary(signs), synced: true });
    setDangerSelected(new Set());
    setDangerExpanded(false);
  }

  async function handleSymptomSave() {
    setSaving(true);
    setError(null);
    setSavedLabel(null);
    const result = await logSymptom(
      patientId,
      { symptomType, severity, description: description.trim() || undefined },
      beneficiaryProfileId
    );
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSavedLabel("Symptom logged.");
    setDescription("");
    await refreshHistory();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Symptoms</Text>
        <MutedText>Log a symptom and see your recent history.</MutedText>
      </View>

      <Card style={{ gap: 0, borderColor: "#FECACA", padding: 0, overflow: "hidden" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: dangerExpanded }}
          onPress={() => setDangerExpanded((prev) => !prev)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: spacing.card,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
            <Ionicons name="warning" size={18} color={colors.status.emergency} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.status.emergency, flexShrink: 1 }}>
              Feeling something serious right now?
            </Text>
          </View>
          <Ionicons name={dangerExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.status.emergency} />
        </Pressable>

        {dangerExpanded ? (
          <View style={{ padding: spacing.card, paddingTop: 0, gap: 10 }}>
            <MutedText>
              Tap anything you&apos;re experiencing. If it&apos;s a medical emergency, we&apos;ll tell you what to do;
              TarragonHealth does not provide emergency care, so you should go to your nearest hospital.
            </MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {DANGER_SIGNS.map((sign) => {
                const isOn = dangerSelected.has(sign);
                return (
                  <Pressable
                    key={sign}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isOn }}
                    hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                    onPress={() => toggleDangerSign(sign)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: isOn ? colors.status.emergency : colors.border,
                      backgroundColor: isOn ? colors.status.emergency : colors.card,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: isOn ? "#FFFFFF" : colors.ink }}>
                      {DANGER_SIGN_LABEL[sign]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {dangerError ? <ErrorText>{dangerError}</ErrorText> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: dangerSaving || dangerSelected.size === 0 }}
              disabled={dangerSaving || dangerSelected.size === 0}
              onPress={handleDangerSubmit}
              style={({ pressed }) => ({
                backgroundColor: dangerSelected.size === 0 ? colors.faint : pressed ? "#B91C1C" : colors.status.emergency,
                borderRadius: radius.control,
                paddingVertical: 13,
                alignItems: "center",
                justifyContent: "center",
              })}
            >
              {dangerSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>Get emergency guidance</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Log a symptom</Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {SYMPTOM_TYPES.map((t) => (
            <Pressable
              key={t}
              accessibilityRole="radio"
              accessibilityLabel={SYMPTOM_LABEL[t]}
              accessibilityState={{ selected: symptomType === t, checked: symptomType === t }}
              hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
              onPress={() => setSymptomType(t)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: symptomType === t ? colors.brand : inkAlpha(0.05),
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: symptomType === t ? "#FFFFFF" : colors.muted }}>
                {SYMPTOM_LABEL[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Severity</Text>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{severity}/10</Text>
          </View>
          {/* A row of tappable numbers rather than a slider — React Native has
              no built-in range control and this app has no slider dependency
              installed yet; discrete 1-10 selection is functionally
              equivalent to symptom-log-form.tsx's <input type="range">. */}
          <View
            accessibilityRole="adjustable"
            accessibilityLabel="Severity"
            accessibilityValue={{ min: 1, max: 10, now: severity }}
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
          >
            {SEVERITY_SCALE.map((n) => {
              const isOn = severity === n;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={`Severity ${n} out of 10`}
                  accessibilityState={{ selected: isOn }}
                  hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                  onPress={() => setSeverity(n)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isOn ? severityChipColor(n) : inkAlpha(0.05),
                  }}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: isOn ? "#FFFFFF" : colors.muted }}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          <MutedText>1 = barely noticeable, 10 = worst you&apos;ve ever felt.</MutedText>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Note (optional)</Text>
          <TextInput
            placeholder="Anything else worth telling your care team"
            placeholderTextColor={colors.faint}
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
            style={{
              minHeight: 70,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.control,
              paddingHorizontal: 10,
              paddingVertical: 8,
              fontSize: 14,
              color: colors.ink,
              textAlignVertical: "top",
            }}
          />
        </View>

        {error ? <ErrorText>{error}</ErrorText> : null}
        {savedLabel ? <MutedText>{savedLabel}</MutedText> : null}
        <PrimaryButton title="Save symptom" onPress={handleSymptomSave} loading={saving} />
      </Card>

      <View style={{ gap: 10 }}>
        <SectionLabel>Recent symptoms</SectionLabel>
        {historyLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : historyError ? (
          <Card>
            <ErrorText>{historyError}</ErrorText>
          </Card>
        ) : history.length === 0 ? (
          <Card>
            <MutedText>No symptoms logged yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {history.map((symptom) => (
              <GroupedListRow
                key={symptom.id}
                title={`${symptomLabel(symptom.symptom_type)}: severity ${symptom.severity ?? "—"}/10`}
                subtitle={
                  symptom.description
                    ? `${symptom.description} · ${new Date(symptom.reported_at).toLocaleString()}`
                    : new Date(symptom.reported_at).toLocaleString()
                }
                trailing={
                  symptom.is_red_flag ? (
                    <View style={{ backgroundColor: "#FEE2E2", borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.status.critical }}>
                        Flagged for review
                      </Text>
                    </View>
                  ) : (
                    "none"
                  )
                }
              />
            ))}
          </GroupedList>
        )}
      </View>

      <EmergencyGuidanceModal
        visible={guidance !== null}
        detail={guidance?.detail ?? ""}
        synced={guidance?.synced ?? false}
        emergencyContact={emergencyContact}
        state={patientState}
        onDismiss={() => setGuidance(null)}
      />
    </ScrollView>
  );
}
