import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import { PDF_CONTACT_EMAIL } from "@/lib/pdf/pdf-brand";
import { PROVENANCE_LABEL, type DoctorSummary } from "./doctor-summary";

registerPdfFonts();

// Low ink on purpose: black on white, hairline rules, no logo, no fills.
const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 34, fontSize: 9, color: "#000", fontFamily: PDF_FONT_FAMILY, lineHeight: 1.3 },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#000", paddingBottom: 6, marginBottom: 8 },
  title: { fontSize: 14, fontWeight: 700 },
  small: { fontSize: 8, color: "#333" },
  idRow: { flexDirection: "row", gap: 14, marginBottom: 4 },
  critical: { borderWidth: 1, borderColor: "#000", padding: 5, marginBottom: 8 },
  sectionTitle: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", marginTop: 7, marginBottom: 2, borderBottomWidth: 0.5, borderBottomColor: "#000" },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  lineText: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
  tag: { fontSize: 7, color: "#333", width: 120, textAlign: "right" },
  footer: { position: "absolute", bottom: 16, left: 34, right: 34, fontSize: 7, color: "#333", borderTopWidth: 0.5, borderTopColor: "#000", paddingTop: 4 },
});

/**
 * A single page for a facility that does not know the patient (S43, spec 2.9).
 * Every line is tagged with who stands behind it. The footer says what the page is
 * not: a full record, and not to be relied on in place of the clinician's own
 * assessment.
 */
export function DoctorSummaryDocument({ summary }: { summary: DoctorSummary }) {
  const p = summary.patient;
  return (
    <Document title={`Summary for a facility - ${p.name}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <View>
            <Text style={styles.title}>Patient summary</Text>
            <Text style={styles.small}>Prepared by the patient through TarragonHealth, {summary.generatedOn}</Text>
          </View>
          <Text style={styles.small}>{PDF_CONTACT_EMAIL}</Text>
        </View>

        <View style={styles.idRow}>
          <Text style={{ fontWeight: 700 }}>{p.name}</Text>
          {p.dateOfBirth && <Text>Born {p.dateOfBirth}</Text>}
          {p.sex && <Text>Sex {p.sex}</Text>}
          {p.patientNumber && <Text>No. {p.patientNumber}</Text>}
        </View>

        {(summary.blood || summary.emergencyContact) && (
          <View style={styles.critical}>
            {summary.blood && (
              <View style={styles.line}>
                <Text style={styles.lineText}>{summary.blood.text}</Text>
                <Text style={styles.tag}>{PROVENANCE_LABEL[summary.blood.provenance]}</Text>
              </View>
            )}
            {summary.emergencyContact && (
              <View style={styles.line}>
                <Text style={styles.lineText}>Emergency contact: {summary.emergencyContact.text}</Text>
              </View>
            )}
          </View>
        )}

        {summary.sections.map((s) => (
          <View key={s.key} wrap={false}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            {s.lines.length === 0 ? (
              <Text style={styles.small}>{s.emptyText}</Text>
            ) : (
              s.lines.map((l, i) => (
                <View key={i} style={styles.line}>
                  <Text style={styles.lineText}>
                    {l.text}
                    {l.detail ? `: ${l.detail}` : ""}
                  </Text>
                  <Text style={styles.tag}>{PROVENANCE_LABEL[l.provenance]}</Text>
                </View>
              ))
            )}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          This is a summary the patient chose to share. It is not a complete medical record and may be out of date. Lines marked entered by the patient have not been checked by a clinician. It does not replace your own assessment. Mental health and reproductive health records are never included.
        </Text>
      </Page>
    </Document>
  );
}
