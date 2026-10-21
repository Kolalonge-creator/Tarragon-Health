import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import type { BuiltLetter } from "./letter";

registerPdfFonts();

/**
 * The records request letter as an A4 page: black text on white, no logo, no colour and no image, so it prints well on any office printer and
 * photocopies cleanly. All wording comes from the built letter (versioned configuration); this file only lays it out.
 */
const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 11, color: "#000000", padding: 56, lineHeight: 1.45 },
  title: { fontSize: 15, fontWeight: 700, marginBottom: 14 },
  date: { textAlign: "right", marginBottom: 14 },
  block: { marginBottom: 12 },
  heading: { fontWeight: 700, marginBottom: 4 },
  line: { marginBottom: 2 },
  bullet: { marginBottom: 2, paddingLeft: 12 },
  fill: { marginTop: 8 },
  rule: { borderBottomWidth: 0.75, borderBottomColor: "#000000", height: 16, marginBottom: 4 },
  signature: { marginTop: 26, fontWeight: 700 },
  signLine: { borderBottomWidth: 0.75, borderBottomColor: "#000000", width: 200, height: 26, marginBottom: 4 },
  footer: { position: "absolute", bottom: 32, left: 56, right: 56, fontSize: 9 },
});

export function RecordsRequestLetterDocument({ letter }: { letter: BuiltLetter }) {
  return (
    <Document title={letter.title} author="TarragonHealth">
      <Page size="A4" style={styles.page}>
        <Text style={styles.date}>{letter.dateLine}</Text>
        <Text style={styles.block}>{letter.greeting}</Text>
        <Text style={styles.title}>{letter.title}</Text>
        <Text style={styles.block}>{letter.intro}</Text>

        <View style={styles.block}>
          <Text style={styles.heading}>{letter.scopeHeading}</Text>
          {letter.scopeLines.map((l) => (
            <Text key={l} style={styles.bullet}>
              {`- ${l}`}
            </Text>
          ))}
        </View>

        <Text style={styles.block}>{letter.format}</Text>

        <View style={styles.block}>
          <Text style={styles.heading}>{letter.identityHeading}</Text>
          {letter.identityLines.map((l) => (
            <Text key={l} style={styles.line}>
              {l}
            </Text>
          ))}
          {letter.fillInLines.map((l) => (
            <View key={l} style={styles.fill}>
              <Text>{l}</Text>
              <View style={styles.rule} />
            </View>
          ))}
        </View>

        <Text style={styles.block}>{letter.timing}</Text>
        <Text style={styles.block}>{letter.closing}</Text>

        <View style={styles.signature}>
          <Text style={{ fontWeight: 400 }}>{letter.signOff}</Text>
          <View style={styles.signLine} />
          <Text>{letter.signatureLine}</Text>
        </View>

        <Text style={styles.footer} fixed>
          {letter.draftNotice ? `${letter.footer} ${letter.draftNotice}` : letter.footer}
        </Text>
      </Page>
    </Document>
  );
}
