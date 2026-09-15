import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatHba1cWithBracket } from "@/lib/rules/hba1c-bracket";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import { PDF_LOGO_SRC, PDF_CONTACT_EMAIL } from "@/lib/pdf/pdf-brand";
import type { HealthPassportData } from "./get-health-passport-data";

registerPdfFonts();

const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Heart rate",
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
  page: { paddingTop: 40, paddingBottom: 64, paddingHorizontal: 44, fontSize: 10, color: "#12324B", fontFamily: PDF_FONT_FAMILY },
  letterhead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: "#0E7C52",
    paddingBottom: 12,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 32, height: 32 },
  brand: { fontSize: 15, fontWeight: 700, color: "#0E7C52" },
  tagline: { fontSize: 8, color: "#666", marginTop: 1 },
  metaBlock: { alignItems: "flex-end" },
  metaLabel: { fontSize: 7, color: "#8a8a8a", textTransform: "uppercase" },
  metaValue: { fontSize: 9, color: "#12324B", marginBottom: 3 },
  title: { fontSize: 19, fontWeight: 700, marginBottom: 4, color: "#12324B" },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 22 },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    color: "#0E7C52",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    borderBottomWidth: 0.75,
    borderBottomColor: "#0E7C52",
    paddingBottom: 4,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#e2e2e2" },
  muted: { color: "#666" },
  confidential: {
    fontSize: 7,
    color: "#8a8a8a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 0.75,
    borderTopColor: "#0E7C52",
    paddingTop: 8,
  },
  footerText: { fontSize: 8, color: "#666", lineHeight: 1.4, maxWidth: 430 },
  pageNumber: { fontSize: 8, color: "#8a8a8a" },
});

export function HealthPassportDocument({
  patientName,
  data,
  documentTitle = "Health Passport",
}: {
  patientName: string;
  data: HealthPassportData;
  /** Reused verbatim by the quarterly report
   * (see lib/reports/generate-quarterly-report.ts) — same layout, same
   * data shape (just a shorter period window), different title so it
   * reads as its own named artifact rather than a re-skinned Health
   * Passport. */
  documentTitle?: string;
}) {
  const periodLabel = `${new Date(data.periodStart).toLocaleDateString()} - ${new Date(
    data.periodEnd
  ).toLocaleDateString()}`;

  return (
    <Document title={`${documentTitle} - ${patientName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.letterhead}>
          <View style={styles.brandRow}>
            {/* react-pdf's Image is not an HTML <img> — no alt prop exists */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={PDF_LOGO_SRC} />
            <View>
              <Text style={styles.brand}>TarragonHealth</Text>
              <Text style={styles.tagline}>Care that stays with you.</Text>
            </View>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Generated</Text>
            <Text style={styles.metaValue}>{new Date().toLocaleDateString()}</Text>
            <Text style={styles.metaLabel}>Contact</Text>
            <Text style={[styles.metaValue, { marginBottom: 0 }]}>{PDF_CONTACT_EMAIL}</Text>
          </View>
        </View>

        <Text style={styles.title}>{documentTitle}</Text>
        <Text style={styles.subtitle}>
          {patientName} · {periodLabel} · TarragonHealth
        </Text>
        <Text style={styles.confidential}>Confidential health record — for the named patient only</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vitals</Text>
          {data.vitals.length === 0 && data.bmi === null && (
            <Text style={styles.muted}>No vitals logged in this period.</Text>
          )}
          {data.bmi !== null && (
            <View style={styles.row}>
              <Text>BMI</Text>
              <Text style={styles.muted}>{data.bmi} kg/m²</Text>
            </View>
          )}
          {data.vitals.map((v) => (
            <View key={v.vitalType} style={styles.row}>
              <Text>{VITAL_LABEL[v.vitalType] ?? v.vitalType}</Text>
              <Text style={styles.muted}>
                {formatVitalValue(v.vitalType, v.latest)} ({v.readingCount} readings, last{" "}
                {new Date(v.takenAt).toLocaleDateString()})
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
                {r.code === "hba1c" ? formatHba1cWithBracket(r.value) : `${r.value} ${r.unit}`} ·{" "}
                {new Date(r.takenAt).toLocaleDateString()}
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

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {data.protocolAuthor
              ? `Protocols supervised by Dr. ${data.protocolAuthor.fullName}${
                  data.protocolAuthor.credentialType && data.protocolAuthor.credentialNumber
                    ? ` (${data.protocolAuthor.credentialType} ${data.protocolAuthor.credentialNumber})`
                    : ""
                }.`
              : "Protocols supervised by your care team's Clinical Director."}
            {"  "}This is an educational summary, not a complete medical record.
            {"\n"}TarragonHealth · Care that stays with you. · {PDF_CONTACT_EMAIL}
          </Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
