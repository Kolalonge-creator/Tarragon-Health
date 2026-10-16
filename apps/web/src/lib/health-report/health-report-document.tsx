import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { RenderModel, Block } from "./render-model";

/**
 * Printable A4, black and white only (S46, principle 11): no logo image, no colour, no fonts to download. States are a word plus a symbol. Text first, so
 * the file stays small on a slow connection. Built from the same RenderModel as the web page.
 */
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 40, paddingHorizontal: 40, fontSize: 10, fontFamily: "Helvetica", color: "#000000", lineHeight: 1.35 },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  meta: { fontSize: 9, marginBottom: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: "#000000", marginVertical: 6 },
  box: { borderWidth: 1, borderColor: "#000000", padding: 6, marginBottom: 4 },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8.5 },
  footer: { position: "absolute", bottom: 18, left: 40, right: 40, fontSize: 8, textAlign: "center" },
});

function BlockPdf({ b }: { b: Block }) {
  switch (b.kind) {
    case "p":
    case "line":
      return <Text style={{ marginBottom: 3 }}>{b.kind === "p" ? b.text : b.text}</Text>;
    case "priority":
      return (
        <View style={s.box} wrap={false}>
          <Text style={s.bold}>{b.n}. {b.action}</Text>
          <Text>{b.why}</Text>
          <Text>Who helps: {b.who}. When: {b.when}.</Text>
        </View>
      );
    case "item":
      return (
        <View style={{ marginBottom: 4 }} wrap={false}>
          <Text>
            <Text style={s.bold}>{b.label}</Text>
            {b.value ? `: ${b.value}` : ""} {b.symbol} <Text style={s.bold}>{b.stateWord}</Text>
          </Text>
          {b.notes.map((n) => (
            <Text key={n} style={s.small}>{n}</Text>
          ))}
        </View>
      );
  }
}

export function HealthReportDocument({ model, standingLine }: { model: RenderModel; standingLine: string }) {
  return (
    <Document title={`${model.title} ${model.yearLine}`}>
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>{model.title}</Text>
        <Text style={s.meta}>{model.yearLine}. {model.versionLine}.</Text>
        <Text style={s.meta}>{model.signedLine}</Text>
        {model.correctionLine ? <Text style={[s.meta, s.bold]}>{model.correctionLine}</Text> : null}
        <View style={s.rule} />
        {model.sections.map((sec) => (
          <View key={sec.id}>
            <Text style={s.h2}>{sec.heading}</Text>
            {sec.blocks.map((b, i) => (
              <BlockPdf key={`${sec.id}-${i}`} b={b} />
            ))}
          </View>
        ))}
        <Text style={s.footer} fixed>{standingLine}</Text>
      </Page>
    </Document>
  );
}
