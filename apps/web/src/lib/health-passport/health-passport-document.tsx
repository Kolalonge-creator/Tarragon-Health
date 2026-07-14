import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { HealthPassportData } from "./get-health-passport-data";

const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Pulse",
  temperature: "Temperature",
  spo2: "SpO2",
};

function formatVitalValue(vitalType: string, latest: Record<string, unknown>): string {
  switch (vitalType) {
    case "blood_pressure":
      return `${latest.systolic}/${latest.diastolic} mmHg`;
    case "glucose":
      return `${latest.glucose_mmol_l} mmol/L`;
    case "weight":
      return `${latest.weight_kg} kg`;
    case "pulse":
      return `${latest.pulse_bpm} bpm`;
    case "temperature":
      return `${latest.temperature_c}°C`;
    case "spo2":
      return `${latest.spo2_pct}%`;
    default:
      return "—";
  }
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: "#12324B" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#0E7C52" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  muted: { color: "#666" },
  footer: { marginTop: 24, fontSize: 8, color: "#666" },
});

export function HealthPassportDocument({
  patientName,
  data,
}: {
  patientName: string;
  data: HealthPassportData;
}) {
  const periodLabel = `${new Date(data.periodStart).toLocaleDateString()} - ${new Date(
    data.periodEnd
  ).toLocaleDateString()}`;

  return (
    <Document title={`Health Passport - ${patientName}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Health Passport</Text>
        <Text style={styles.subtitle}>
          {patientName} · {periodLabel} · TarragonHealth
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vitals</Text>
          {data.vitals.length === 0 && <Text style={styles.muted}>No vitals logged in this period.</Text>}
          {data.vitals.map((v) => (
            <View key={v.vitalType} style={styles.row}>
              <Text>{VITAL_LABEL[v.vitalType] ?? v.vitalType}</Text>
              <Text style={styles.muted}>
                {formatVitalValue(v.vitalType, v.latest)} ({v.readingCount} readings)
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preventive screenings</Text>
          {data.screenings.length === 0 && (
            <Text style={styles.muted}>No screenings due in this period.</Text>
          )}
          {data.screenings.map((s, i) => (
            <View key={i} style={styles.row}>
              <Text>{s.screenTypeName} — {s.status}</Text>
              <Text style={styles.muted}>
                {s.resultStatus ? `Result: ${s.resultStatus}` : ""}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lab results</Text>
          {data.labReadings.length === 0 && (
            <Text style={styles.muted}>No lab results on file this period.</Text>
          )}
          {data.labReadings.map((r, i) => (
            <View key={i} style={styles.row}>
              <Text>{r.code.toUpperCase()}</Text>
              <Text style={styles.muted}>
                {r.value} {r.unit} · {new Date(r.takenAt).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </View>

        {data.reviewedEscalations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Direct doctor review</Text>
            {data.reviewedEscalations.map((esc) => (
              <View key={esc.id} style={{ marginBottom: 6 }}>
                <Text style={styles.muted}>{esc.reason}</Text>
                <Text>
                  Reviewed on {new Date(esc.reviewedAt).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          {data.protocolAuthor
            ? `Protocols supervised by Dr. ${data.protocolAuthor.fullName}${
                data.protocolAuthor.credentialType && data.protocolAuthor.credentialNumber
                  ? ` (${data.protocolAuthor.credentialType} ${data.protocolAuthor.credentialNumber})`
                  : ""
              }.`
            : "Protocols supervised by your care team's Clinical Director."}
          {"  "}This is an educational summary, not a complete medical record.
        </Text>
      </Page>
    </Document>
  );
}
