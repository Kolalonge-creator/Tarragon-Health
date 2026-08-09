import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Share, Text, View } from "react-native";
import { getHealthPassportSummary, type HealthPassportSummary } from "@/lib/health-passport";
import { colors, spacing } from "@/ui/theme";
import { Card, MutedText, SecondaryButton } from "@/ui/components";

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

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>Vitals</Text>
        {data.vitals.length === 0 ? (
          <MutedText>No vitals logged in the last 12 months.</MutedText>
        ) : (
          data.vitals.map((v) => {
            const def = VITAL_LABELS[v.vitalType];
            return (
              <Row
                key={v.vitalType}
                label={def?.label ?? v.vitalType}
                value={`${def ? def.format(v.latest) : "—"} · ${v.readingCount} reading${v.readingCount === 1 ? "" : "s"}`}
              />
            );
          })
        )}
      </Card>

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>Preventive screenings</Text>
        {data.screenings.length === 0 ? (
          <MutedText>No screenings on file yet.</MutedText>
        ) : (
          data.screenings.map((s, i) => (
            <Text key={i} style={{ fontSize: 13, color: colors.ink, paddingVertical: 5 }}>
              {s.screenTypeName}: {s.resultStatus ?? s.status}
            </Text>
          ))
        )}
      </Card>

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>Lab results</Text>
        {data.labReadings.length === 0 ? (
          <MutedText>No lab results in the last 12 months.</MutedText>
        ) : (
          data.labReadings.slice(0, 8).map((r, i) => <Row key={i} label={r.code} value={`${r.value} ${r.unit}`} />)
        )}
      </Card>

      {data.protocolAuthorName ? (
        <MutedText>
          Protocols supervised by Dr. {data.protocolAuthorName}
          {data.protocolAuthorCredential ? ` · ${data.protocolAuthorCredential}` : ""}.
        </MutedText>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
      <Text style={{ fontSize: 13, color: colors.ink }}>{label}</Text>
      <Text style={{ fontSize: 13, color: colors.muted }}>{value}</Text>
    </View>
  );
}
