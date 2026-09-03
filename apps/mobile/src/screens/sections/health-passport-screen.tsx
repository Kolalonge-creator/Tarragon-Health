import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Share, Text, View } from "react-native";
import { getHealthPassportSummary, type HealthPassportSummary } from "@/lib/health-passport";
import { colors, spacing } from "@/ui/theme";
import { Card, GroupedList, GroupedListRow, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/components";

interface HealthPassportScreenProps {
  patientId: string;
  organisationId: string;
  /** Set to the supported person's name when acting for someone
   * (home-shell.tsx), so the heading never claims to be "yours" while
   * showing somebody else's record. */
  subjectName?: string;
}

/** Formatters return null when the reading is missing the expected value —
 * a wearable or partial row could otherwise render as "null mmol/L". The
 * caller falls back to the "—" placeholder. */
const VITAL_LABELS: Record<string, { label: string; format: (v: Record<string, unknown>) => string | null }> = {
  blood_pressure: {
    label: "Blood pressure",
    format: (v) =>
      typeof v.systolic === "number" && typeof v.diastolic === "number"
        ? `${v.systolic}/${v.diastolic} mmHg`
        : null,
  },
  glucose: {
    label: "Glucose",
    format: (v) => (typeof v.glucose_mmol_l === "number" ? `${v.glucose_mmol_l} mmol/L` : null),
  },
  weight: {
    label: "Weight",
    format: (v) => (typeof v.weight_kg === "number" ? `${v.weight_kg} kg` : null),
  },
};

const MAX_LAB_READINGS = 8;

/** Prefixes "Dr." only when the stored name doesn't already begin with a
 * title — clinical_staff.full_name is free text, and "Dr. Dr. Adaeze" would
 * read as sloppy exactly where trust matters most. */
function protocolAuthorDisplay(name: string): string {
  return /^(dr|prof|professor)\.?\s/i.test(name) ? name : `Dr. ${name}`;
}

export function HealthPassportScreen({ patientId, organisationId, subjectName }: HealthPassportScreenProps) {
  const [data, setData] = useState<HealthPassportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    getHealthPassportSummary(patientId, organisationId)
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [patientId, organisationId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (loadError || !data) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing.screen,
          gap: 12,
          backgroundColor: colors.background,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>
          We couldn&apos;t load this right now
        </Text>
        <MutedText>Your record is safe. Check your connection and try again.</MutedText>
        <PrimaryButton title="Tap to retry" onPress={load} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 19, fontWeight: "700", color: colors.ink }}>
          {subjectName ? `${subjectName}'s Health Passport` : "Your Health Passport"}
        </Text>
        <MutedText>
          {subjectName
            ? `A summary of ${subjectName}'s record, to view or share with another doctor.`
            : "A summary of your record, for you or to share with another doctor."}
        </MutedText>
      </View>

      {/* Shares only counts, never the readings themselves — the copy says
          so, rather than implying a full record export it doesn't do. */}
      <SecondaryButton
        title="Share record counts"
        onPress={() =>
          void Share.share({
            message: `TarragonHealth record summary (counts only, not the readings themselves): ${data.vitals.length} vital types tracked, ${data.screenings.length} screenings, ${data.labReadings.length} lab readings over the last 12 months. The full record stays in the TarragonHealth app.`,
          }).catch(() => {})
        }
      />

      <View style={{ gap: 10 }}>
        <SectionLabel>Vitals</SectionLabel>
        {data.vitals.length === 0 ? (
          <Card>
            <MutedText>No vitals logged in the last 12 months.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {data.vitals.map((v) => {
              const def = VITAL_LABELS[v.vitalType];
              return (
                <GroupedListRow
                  key={v.vitalType}
                  title={def?.label ?? v.vitalType}
                  trailing={
                    <Text style={{ fontSize: 12.5, color: colors.muted, textAlign: "right", flexShrink: 1 }}>
                      {def?.format(v.latest) ?? "—"} · {v.readingCount} reading{v.readingCount === 1 ? "" : "s"}
                    </Text>
                  }
                />
              );
            })}
          </GroupedList>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Preventive screenings</SectionLabel>
        {data.screenings.length === 0 ? (
          <Card>
            <MutedText>No screenings on file yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {data.screenings.map((s, i) => (
              <GroupedListRow key={i} title={s.screenTypeName} trailing="none" subtitle={s.resultStatus ?? s.status} />
            ))}
          </GroupedList>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Lab results</SectionLabel>
        {data.labReadings.length === 0 ? (
          <Card>
            <MutedText>No lab results in the last 12 months.</MutedText>
          </Card>
        ) : (
          <View style={{ gap: 6 }}>
            <GroupedList>
              {data.labReadings.slice(0, MAX_LAB_READINGS).map((r, i) => (
                <GroupedListRow
                  key={i}
                  title={r.code}
                  trailing={<Text style={{ fontSize: 12.5, color: colors.muted }}>{r.value} {r.unit}</Text>}
                />
              ))}
            </GroupedList>
            {data.labReadings.length > MAX_LAB_READINGS ? (
              <MutedText>
                Showing {MAX_LAB_READINGS} of {data.labReadings.length} lab readings. The full list is in the
                Labs section.
              </MutedText>
            ) : null}
          </View>
        )}
      </View>

      {data.protocolAuthorName ? (
        <MutedText>
          Protocols supervised by {protocolAuthorDisplay(data.protocolAuthorName)}
          {data.protocolAuthorCredential ? ` · ${data.protocolAuthorCredential}` : ""}.
        </MutedText>
      ) : null}
    </ScrollView>
  );
}
