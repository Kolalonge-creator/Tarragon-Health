import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatGlucose, type GlucoseDisplayUnit } from "@tarragon/shared";
import { GLUCOSE_CONTEXT_LABEL, type VisitReportSummary } from "./summarise";

export interface VisitReportData {
  patientName: string;
  generatedAt: string;
  summary: VisitReportSummary;
  glucoseUnit: GlucoseDisplayUnit;
  /** The reading cap was hit, so the oldest readings in the period are not included. */
  truncated?: boolean;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: "#12324B" },
  brand: { fontSize: 12, fontWeight: 700, color: "#0E7C52", marginBottom: 2 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 16 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#0E7C52" },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#D9E4DD" },
  label: { width: "40%", color: "#444" },
  value: { width: "60%" },
  callout: {
    marginTop: 4,
    padding: 8,
    backgroundColor: "#F1F7F3",
    borderLeftWidth: 2,
    borderLeftColor: "#0E7C52",
    lineHeight: 1.5,
  },
  footer: { marginTop: 20, fontSize: 8, color: "#666", lineHeight: 1.5 },
});

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function VisitReportDocument({ data }: { data: VisitReportData }) {
  const { summary } = data;
  const glucose = (mmolL: number, withUnit = true): string =>
    formatGlucose(mmolL, data.glucoseUnit, { withUnit }) ?? "";
  const empty =
    !summary.bp && summary.glucoseByContext.length === 0 && !summary.pulse && !summary.weight;
  return (
    <Document title="Report for your visit" author="TarragonHealth">
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>TarragonHealth</Text>
        <Text style={styles.title}>Report for your visit</Text>
        <Text style={styles.subtitle}>
          {data.patientName} · last {summary.periodDays} days · made {formatDate(data.generatedAt)}
        </Text>

        {empty && (
          <View style={styles.callout}>
            <Text>No readings were logged in this period, so there is nothing to summarise.</Text>
          </View>
        )}

        {summary.bp && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Blood pressure (mmHg)</Text>
            <Row label="Readings" value={String(summary.bp.count)} />
            <Row
              label="Average"
              value={`${summary.bp.averageSystolic}/${summary.bp.averageDiastolic}`}
            />
            <Row
              label="Lowest to highest top number"
              value={`${summary.bp.minSystolic} to ${summary.bp.maxSystolic}`}
            />
            <Row
              label="Lowest to highest bottom number"
              value={`${summary.bp.minDiastolic} to ${summary.bp.maxDiastolic}`}
            />
            <Row
              label="Latest"
              value={`${summary.bp.latest.systolic}/${summary.bp.latest.diastolic} on ${formatDate(summary.bp.latest.takenAt)}`}
            />
          </View>
        )}

        {summary.glucoseByContext.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Blood sugar</Text>
            {summary.glucoseByContext.map((g) => (
              <Row
                key={g.context}
                label={`${GLUCOSE_CONTEXT_LABEL[g.context] ?? g.context} (${g.count})`}
                value={`average ${glucose(g.average)}, from ${glucose(g.min, false)} to ${glucose(g.max)}`}
              />
            ))}
          </View>
        )}

        {summary.pulse && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pulse (beats per minute)</Text>
            <Row label="Readings" value={String(summary.pulse.count)} />
            <Row
              label="Average, lowest to highest"
              value={`${Math.round(summary.pulse.average)}, from ${summary.pulse.min} to ${summary.pulse.max}`}
            />
          </View>
        )}

        {summary.weight && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Weight (kg)</Text>
            <Row
              label="First in this period"
              value={`${summary.weight.first.kg} on ${formatDate(summary.weight.first.takenAt)}`}
            />
            <Row
              label="Latest"
              value={`${summary.weight.latest.kg} on ${formatDate(summary.weight.latest.takenAt)}`}
            />
            <Row
              label="Change"
              value={`${summary.weight.changeKg > 0 ? "+" : ""}${summary.weight.changeKg}`}
            />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Where these readings came from</Text>
          <Row label="Typed in by you" value={String(summary.sourceCounts.manual)} />
          <Row label="From a connected device" value={String(summary.sourceCounts.device)} />
          <Row label="Wearable estimates" value={String(summary.sourceCounts.wearable)} />
          {summary.excludedUnvalidated > 0 && (
            <Row
              label="Left out, still being checked"
              value={String(summary.excludedUnvalidated)}
            />
          )}
        </View>

        {data.truncated && (
          <Text style={styles.footer}>
            You have a very large number of readings in this period, so the oldest ones are not
            included here.
          </Text>
        )}

        <Text style={styles.footer}>
          This is a summary of readings you logged yourself. It describes them and does not give a
          diagnosis or tell you what to do. Wearable estimates are not clinical measurements. Take
          this to your appointment, or share it with your care team in the app.
        </Text>
      </Page>
    </Document>
  );
}
