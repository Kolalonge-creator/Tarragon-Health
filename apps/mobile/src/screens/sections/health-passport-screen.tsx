import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Share, Text, View } from "react-native";
import { getHealthPassportSummary, type HealthPassportSummary } from "@/lib/health-passport";
import { colors, spacing } from "@/ui/theme";
import { Card, GroupedList, GroupedListRow, MutedText, SecondaryButton, SectionLabel } from "@/ui/components";

interface HealthPassportScreenProps {
  patientId: string;
  organisationId: string;
  /** Set to the supported person's name when acting for someone
   * (home-shell.tsx), so the heading never claims to be "yours" while
   * showing somebody else's record. */
  subjectName?: string;
}

const VITAL_LABELS: Record<string, { label: string; format: (v: Record<string, unknown>) => string }> = {
  blood_pressure: { label: "Blood pressure", format: (v) => `${v.systolic}/${v.diastolic} mmHg` },
  glucose: { label: "Glucose", format: (v) => `${v.glucose_mmol_l} mmol/L` },
  weight: { label: "Weight", format: (v) => `${v.weight_kg} kg` },
};

export function HealthPassportScreen({ patientId, organisationId, subjectName }: HealthPassportScreenProps) {
  const [data, setData] = useState<HealthPassportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHealthPassportSummary(patientId, organisationId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [patientId, organisationId]);

  if (loading || !data) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
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
            ? `A summary of ${subjectName}'s record — to view, or share with another doctor.`
            : "A summary of your record — for you, or to share with another doctor."}
        </MutedText>
      </View>

      <SecondaryButton
        title="Share summary"
        onPress={() =>
          Share.share({
            message: `TarragonHealth Health Passport — ${data.vitals.length} vital types, ${data.screenings.length} screenings, ${data.labReadings.length} lab readings over the last 12 months.`,
          })
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
                      {def ? def.format(v.latest) : "—"} · {v.readingCount} reading{v.readingCount === 1 ? "" : "s"}
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
          <GroupedList>
            {data.labReadings.slice(0, 8).map((r, i) => (
              <GroupedListRow
                key={i}
                title={r.code}
                trailing={<Text style={{ fontSize: 12.5, color: colors.muted }}>{r.value} {r.unit}</Text>}
              />
            ))}
          </GroupedList>
        )}
      </View>

      {data.protocolAuthorName ? (
        <MutedText>
          Protocols supervised by Dr. {data.protocolAuthorName}
          {data.protocolAuthorCredential ? ` · ${data.protocolAuthorCredential}` : ""}.
        </MutedText>
      ) : null}
    </ScrollView>
  );
}
