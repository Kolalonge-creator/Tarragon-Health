import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  loadConditions,
  loadAllergies,
  addAllergy,
  type PatientCondition,
  type PatientAllergy,
  type AllergySeverity,
} from "@/lib/health-summary";
import type { Enums } from "@tarragon/shared";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, GroupedList, GroupedListRow, MutedText, PrimaryButton, ScreenTitle } from "@/ui/components";

type ConditionStatus = Enums<"condition_clinical_status">;

const CONDITION_STATUS_LABEL: Record<ConditionStatus, string> = {
  suspected: "Suspected",
  under_investigation: "Under investigation",
  active: "Active",
  uncontrolled: "Uncontrolled",
  controlled: "Controlled",
  resolved: "Resolved",
  historical: "Historical",
};

const CONDITION_STATUS_COLOR: Record<ConditionStatus, { bg: string; text: string }> = {
  suspected: { bg: colors.status.warnBg, text: colors.status.warn },
  under_investigation: { bg: colors.status.warnBg, text: colors.status.warn },
  active: { bg: "#FDECEC", text: colors.status.critical },
  uncontrolled: { bg: "#FDECEC", text: colors.status.critical },
  controlled: { bg: colors.brandTint, text: colors.brandPressed },
  resolved: { bg: colors.groupBg, text: colors.muted },
  historical: { bg: colors.groupBg, text: colors.muted },
};

const ALLERGY_SEVERITY_LABEL: Record<AllergySeverity, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

function StatusChip({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: text }}>{label}</Text>
    </View>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

interface HealthSummaryScreenProps {
  patientId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Everything about me" — mirrors apps/web/.../patient/health-summary/
 * page.tsx's structure but doesn't rebuild every sub-widget natively.
 * Conditions/Allergies are the two domains with no native reader anywhere
 * else in the app (same rationale as the web page's own comment), so they
 * get real native lists here; Medications/Vitals/Labs/Appointments/
 * Prevention already have their own native screens, so this page links out
 * to them rather than re-fetching and re-rendering a second summary of the
 * same data.
 */
export function HealthSummaryScreen({ patientId, onNavigate }: HealthSummaryScreenProps) {
  const [conditions, setConditions] = useState<PatientCondition[]>([]);
  const [allergies, setAllergies] = useState<PatientAllergy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [allergen, setAllergen] = useState("");
  const [reaction, setReaction] = useState("");
  const [severity, setSeverity] = useState<AllergySeverity | "">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [conditionsResult, allergiesResult] = await Promise.all([
      loadConditions(patientId),
      loadAllergies(patientId),
    ]);
    if (!conditionsResult.ok) {
      setError(conditionsResult.error);
      return;
    }
    if (!allergiesResult.ok) {
      setError(allergiesResult.error);
      return;
    }
    setError(null);
    setConditions(conditionsResult.data);
    setAllergies(allergiesResult.data);
  }, [patientId]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  async function submitAllergy() {
    setFormError(null);
    setSaving(true);
    const result = await addAllergy({ patientId, allergen, reaction, severity });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setAllergen("");
    setReaction("");
    setSeverity("");
    setFormOpen(false);
    void refresh();
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Your health summary</ScreenTitle>
        <MutedText>
          Everything about your care in one place: conditions, allergies, and quick links to the rest of your
          record.
        </MutedText>
      </View>

      {error && <ErrorText>{error}</ErrorText>}

      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Conditions</Text>
        {conditions.length === 0 && (
          <MutedText>Nothing on file yet. Your care team adds a condition here once it has been confirmed.</MutedText>
        )}
        {conditions.map((c) => {
          const tone = CONDITION_STATUS_COLOR[c.status];
          return (
            <Card key={c.id} style={{ gap: 4, marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>
                  {c.condition_name}
                </Text>
                <StatusChip label={CONDITION_STATUS_LABEL[c.status]} bg={tone.bg} text={tone.text} />
              </View>
              {(c.severity || c.date_identified) && (
                <MutedText>
                  {c.severity ? `${c.severity[0].toUpperCase()}${c.severity.slice(1)} severity` : ""}
                  {c.severity && c.date_identified ? " · " : ""}
                  {c.date_identified ? `Identified ${when(c.date_identified)}` : ""}
                </MutedText>
              )}
            </Card>
          );
        })}
      </View>

      <View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Allergies</Text>
          <Text
            onPress={() => setFormOpen((v) => !v)}
            style={{ fontSize: 13, fontWeight: "600", color: colors.brand }}
          >
            {formOpen ? "Cancel" : "+ Add"}
          </Text>
        </View>

        {formOpen && (
          <Card style={{ gap: 10, marginBottom: 8 }}>
            <TextInput
              value={allergen}
              onChangeText={setAllergen}
              placeholder="Allergen (e.g. Penicillin)"
              style={textInputStyle}
            />
            <TextInput
              value={reaction}
              onChangeText={setReaction}
              placeholder="Reaction (optional)"
              style={textInputStyle}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["mild", "moderate", "severe"] as const).map((s) => (
                <Text
                  key={s}
                  onPress={() => setSeverity(severity === s ? "" : s)}
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 999,
                    backgroundColor: severity === s ? colors.brand : colors.groupBg,
                    color: severity === s ? "#FFFFFF" : colors.ink,
                    overflow: "hidden",
                  }}
                >
                  {ALLERGY_SEVERITY_LABEL[s]}
                </Text>
              ))}
            </View>
            {formError && <ErrorText>{formError}</ErrorText>}
            <PrimaryButton title="Save allergy" onPress={submitAllergy} loading={saving} />
          </Card>
        )}

        {allergies.length === 0 && !formOpen && <MutedText>No allergies on file.</MutedText>}
        {allergies.map((a) => (
          <Card key={a.id} style={{ gap: 4, marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>{a.allergen}</Text>
              {a.severity && (
                <StatusChip
                  label={ALLERGY_SEVERITY_LABEL[a.severity]}
                  bg={a.severity === "severe" ? "#FDECEC" : colors.groupBg}
                  text={a.severity === "severe" ? colors.status.critical : colors.muted}
                />
              )}
            </View>
            {a.reaction && <MutedText>{a.reaction}</MutedText>}
          </Card>
        ))}
      </View>

      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>Rest of your record</Text>
        <GroupedList>
          <GroupedListRow
            leading={<Ionicons name="medkit-outline" size={18} color={colors.brand} />}
            title="Medications"
            subtitle="Today's doses and your full cabinet"
            onPress={() => onNavigate("medications")}
          />
          <GroupedListRow
            leading={<Ionicons name="pulse-outline" size={18} color={colors.brand} />}
            title="Recent measurements"
            subtitle="Vitals history and trends"
            onPress={() => onNavigate("vitals")}
          />
          <GroupedListRow
            leading={<Ionicons name="flask-outline" size={18} color={colors.brand} />}
            title="Recent investigations"
            subtitle="Lab results and bookings"
            onPress={() => onNavigate("labs")}
          />
          <GroupedListRow
            leading={<Ionicons name="calendar-outline" size={18} color={colors.brand} />}
            title="Appointments"
            subtitle="Book or manage an appointment"
            onPress={() => onNavigate("appointments")}
          />
          <GroupedListRow
            leading={<Ionicons name="shield-checkmark-outline" size={18} color={colors.brand} />}
            title="Preventive tasks"
            subtitle="Screenings and vaccinations due"
            onPress={() => onNavigate("prevention")}
          />
        </GroupedList>
      </View>
    </ScrollView>
  );
}
