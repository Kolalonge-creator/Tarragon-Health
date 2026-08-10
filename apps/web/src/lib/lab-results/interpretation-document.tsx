import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface InterpretationData {
  patientName: string;
  documentTitle: string;
  uploadedAt: string;
  interpretation: string;
  /** Null when the result needed no action. */
  nextSteps: string | null;
  interpretationSentAt: string;
  /**
   * Null-gated, exactly like ReviewedByDoctor (docs/CLINICAL_TRUST_MODEL_SPEC.md
   * §2) — a name is printed only when a real clinical_staff row backs it.
   */
  doctorName: string | null;
  doctorCredentialType: string | null;
  doctorCredentialNumber: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: "#12324B" },
  brand: { fontSize: 12, fontWeight: 700, color: "#0E7C52", marginBottom: 2 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 16 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#0E7C52" },
  body: { lineHeight: 1.5 },
  callout: {
    marginTop: 4,
    padding: 8,
    backgroundColor: "#F1F7F3",
    borderLeftWidth: 2,
    borderLeftColor: "#0E7C52",
  },
  footer: { marginTop: 20, fontSize: 8, color: "#666" },
});

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** One result's worth of page content — shared by the single and combined documents. */
function ResultPage({ data }: { data: InterpretationData }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.brand}>TarragonHealth</Text>
      <Text style={styles.title}>Your result, explained</Text>
      <Text style={styles.subtitle}>
        {data.documentTitle} · uploaded {formatDate(data.uploadedAt)} · {data.patientName}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>What this result means</Text>
        <Text style={styles.body}>{data.interpretation}</Text>
      </View>

      {data.nextSteps && (
        <View style={styles.callout}>
          <Text style={{ fontWeight: 700, marginBottom: 3 }}>Next steps</Text>
          <Text style={styles.body}>{data.nextSteps}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reviewed by</Text>
        {data.doctorName ? (
          <Text>
            {data.doctorName}
            {data.doctorCredentialType && data.doctorCredentialNumber
              ? ` (${data.doctorCredentialType} ${data.doctorCredentialNumber})`
              : ""}
            , TarragonHealth care team · {formatDate(data.interpretationSentAt)}
          </Text>
        ) : (
          <Text>Your TarragonHealth care team · {formatDate(data.interpretationSentAt)}</Text>
        )}
      </View>

      <Text style={styles.footer}>
        This is a written summary of your test result, not a complete medical record or a
        prescription. If anything here is unclear, message your care team in the app.
      </Text>
    </Page>
  );
}

/**
 * A doctor's plain-language interpretation of one uploaded lab result, as a
 * downloadable PDF — the other half of "upload any lab result and a doctor's
 * plain-language interpretation is sent to you in the app" (the in-app card
 * in result-documents.tsx is the "open it without downloading" half).
 */
export function InterpretationDocument({ data }: { data: InterpretationData }) {
  return (
    <Document title={`Result interpretation - ${data.patientName}`}>
      <ResultPage data={data} />
    </Document>
  );
}

/**
 * Several results in one PDF, one per page, in whatever order the caller
 * selected them — the "one PDF for multiple tests" half of the same feature.
 * Downloading them separately is just opening each result's own
 * InterpretationDocument, already available one per document; this is the
 * "combine the ones I picked" alternative, picked at download time.
 */
export function CombinedInterpretationDocument({ items }: { items: InterpretationData[] }) {
  const patientName = items[0]?.patientName ?? "Patient";
  return (
    <Document title={`Result interpretations - ${patientName}`}>
      {items.map((data, i) => (
        <ResultPage key={`${data.documentTitle}-${i}`} data={data} />
      ))}
    </Document>
  );
}
