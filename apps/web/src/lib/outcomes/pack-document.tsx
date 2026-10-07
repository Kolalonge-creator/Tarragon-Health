import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { PackRow } from "./pack";

/** The pilot / renewal pack as a PDF: the fixed evaluation-design note first, then the figures grouped by section. Built from the same rows as the CSV. */
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 16, marginBottom: 6 },
  h2: { fontSize: 12, marginTop: 12, marginBottom: 4 },
  note: { marginBottom: 6, lineHeight: 1.4 },
  row: { flexDirection: "row", marginBottom: 2 },
  item: { width: "50%", paddingRight: 6 },
  value: { width: "50%" },
});

export function PackDocument({ title, design, caveat, rows }: { title: string; design: string; caveat: string; rows: readonly PackRow[] }) {
  const sections = [...new Set(rows.map((r) => r.section))].filter((s) => s !== "evaluation_design" && s !== "caveat");
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{title}</Text>
        <Text style={styles.h2}>How to read this pack</Text>
        <Text style={styles.note}>{design}</Text>
        <Text style={styles.note}>{caveat}</Text>
        {sections.map((s) => (
          <View key={s}>
            <Text style={styles.h2}>{s.replaceAll("_", " ")}</Text>
            {rows.filter((r) => r.section === s).map((r, i) => (
              <View key={`${s}-${i}`} style={styles.row} wrap={false}>
                <Text style={styles.item}>{r.item}</Text>
                <Text style={styles.value}>{r.value}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
