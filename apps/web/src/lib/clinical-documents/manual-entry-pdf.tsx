import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import { PDF_CLINICAL_NAVY } from "@/lib/pdf/pdf-brand";

registerPdfFonts();

/**
 * CDE-02: when a Care Coordinator types results in without an original report, this is the document the clinician checks against:
 * a plain record of exactly what was typed, by whom, when and from what source. It is labelled as a transcription, never as a
 * laboratory report.
 */
export type ManualEntryRecord = {
  patientName: string;
  enteredByName: string;
  enteredAt: Date;
  sourceDescription: string;
  laboratory: string;
  reportDate: string;
  /** Exactly as typed: no unit conversion, no catalogue renaming beyond the test's own name. */
  rows: { test: string; result: string; unit: string; labRange: string; labFlag: string; specimenComment: string }[];
};

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: PDF_FONT_FAMILY, fontSize: 10, color: "#222" },
  title: { fontSize: 15, color: PDF_CLINICAL_NAVY, marginBottom: 4 },
  warning: { fontSize: 10, marginBottom: 12, color: "#8a4b00" },
  meta: { marginBottom: 2 },
  table: { marginTop: 12, borderTopWidth: 1, borderColor: "#ccc" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#eee", paddingVertical: 4 },
  head: { fontWeight: 700 },
  c1: { width: "26%" },
  c2: { width: "14%" },
  c3: { width: "12%" },
  c4: { width: "16%" },
  c5: { width: "10%" },
  c6: { width: "22%" },
});

function lagos(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(d);
}

function ManualEntryDocument({ r }: { r: ManualEntryRecord }) {
  return (
    <Document title="Lab results typed in by hand">
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Lab results typed in by hand</Text>
        <Text style={styles.warning}>
          This is a record of what was typed, not the laboratory&apos;s report. A doctor checks every value against the source before
          anything is added to the record.
        </Text>
        <Text style={styles.meta}>Patient: {r.patientName}</Text>
        <Text style={styles.meta}>Laboratory: {r.laboratory}</Text>
        <Text style={styles.meta}>Test date: {r.reportDate}</Text>
        <Text style={styles.meta}>Source of the values: {r.sourceDescription}</Text>
        <Text style={styles.meta}>
          Typed in by {r.enteredByName} on {lagos(r.enteredAt)}
        </Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.head]}>
            <Text style={styles.c1}>Test</Text>
            <Text style={styles.c2}>Result</Text>
            <Text style={styles.c3}>Unit</Text>
            <Text style={styles.c4}>Lab range</Text>
            <Text style={styles.c5}>Lab flag</Text>
            <Text style={styles.c6}>Specimen / comment</Text>
          </View>
          {r.rows.map((row, i) => (
            <View style={styles.row} key={`${row.test}-${i}`}>
              <Text style={styles.c1}>{row.test}</Text>
              <Text style={styles.c2}>{row.result}</Text>
              <Text style={styles.c3}>{row.unit}</Text>
              <Text style={styles.c4}>{row.labRange}</Text>
              <Text style={styles.c5}>{row.labFlag}</Text>
              <Text style={styles.c6}>{row.specimenComment}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

export async function renderManualEntryPdf(record: ManualEntryRecord): Promise<Buffer> {
  return renderToBuffer(<ManualEntryDocument r={record} />);
}
