import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import type { ReceiptView } from "./consent-receipt";

registerPdfFonts();

/**
 * The consent receipt page: A4, black on white, no colour and no logo image, so it prints cleanly on any printer and a photocopy
 * stays readable. Noto Sans is registered (the app's PDF font) so names and agreement text with Yoruba or Igbo marks, curly quotes or the naira
 * sign print correctly. A section that holds long agreement text is allowed to flow to a second page, so the exact words are never cut.
 */
const styles = StyleSheet.create({
  page: { padding: 34, fontSize: 9.5, color: "#000000", backgroundColor: "#ffffff", fontFamily: PDF_FONT_FAMILY, lineHeight: 1.4 },
  brand: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: "#000000", marginBottom: 12, marginTop: 6 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  meta: { fontSize: 10, marginBottom: 2 },
  section: { marginTop: 7 },
  heading: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  row: { flexDirection: "row", marginBottom: 1.5 },
  label: { width: 150, fontWeight: 700 },
  value: { flex: 1 },
  quote: { marginTop: 6, padding: 6, borderWidth: 1, borderColor: "#000000", fontSize: 9.5 },
  note: { marginTop: 8, padding: 6, borderWidth: 1.5, borderColor: "#000000", fontWeight: 700 },
  small: { marginTop: 5, fontSize: 9 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, flexDirection: "row", justifyContent: "space-between" },
});

export function ConsentReceiptDocument({ view }: { view: ReceiptView }) {
  return (
    <Document title={view.title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>TarragonHealth</Text>
        <View style={styles.rule} />
        <Text style={styles.title}>{view.title}</Text>
        {view.person ? <Text style={styles.meta}>{view.person}</Text> : null}
        <Text style={styles.meta}>{view.prepared}</Text>

        {view.placeholderNote ? (
          <View style={styles.note}>
            <Text>{view.placeholderNote}</Text>
          </View>
        ) : null}

        {view.sections.map((section, i) => (
          <View key={i} style={styles.section} wrap={Boolean(section.quote)}>
            {section.heading ? <Text style={styles.heading}>{section.heading}</Text> : null}
            {section.lines.map((line, j) => (
              <View key={j} style={styles.row}>
                <Text style={styles.label}>{line.label}</Text>
                <Text style={styles.value}>{line.value}</Text>
              </View>
            ))}
            {section.quote ? <Text style={styles.quote}>{section.quote}</Text> : null}
          </View>
        ))}

        <View style={styles.section}>
          <Text style={styles.small}>{view.howToWithdraw}</Text>
          <Text style={styles.small}>{view.noHealthData}</Text>
          <Text style={styles.small}>{view.keepPrivate}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>TarragonHealth</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
