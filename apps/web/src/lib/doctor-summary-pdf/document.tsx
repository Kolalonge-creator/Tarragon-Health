import { Document, Page, Text, View, Svg, Line, Circle, Rect, Polyline, Text as SvgText, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import { PDF_CONTACT_EMAIL } from "@/lib/pdf/pdf-brand";
import { ALLERGY_SOURCE_LABEL, BP_SOURCE_LABEL, type BpChart } from "./model";
import type { DoctorSummaryData } from "./load";

registerPdfFonts();

/**
 * Black on white, hairline rules, no logo and no fills, so it photocopies cleanly. Colour is never the only signal: the chart's
 * two lines differ in line style and marker shape and are named in words. `maxLines` is a style key in react-pdf (it is read off
 * the resolved style, not off the Text props), which is why the long notes below cap through `clamp`.
 */
const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 54, paddingHorizontal: 34, fontSize: 9, color: "#000", fontFamily: PDF_FONT_FAMILY, lineHeight: 1.3 },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#000", paddingBottom: 6, marginBottom: 8 },
  title: { fontSize: 14, fontWeight: 700, marginBottom: 3 },
  small: { fontSize: 8, color: "#333" },
  idRow: { flexDirection: "row", gap: 14, marginBottom: 4 },
  sectionTitle: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", marginTop: 9, marginBottom: 2, borderBottomWidth: 0.5, borderBottomColor: "#000" },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  lineText: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
  tag: { fontSize: 7, color: "#333", width: 130, textAlign: "right" },
  box: { borderWidth: 1, borderColor: "#000", padding: 5, marginVertical: 3 },
  clamp: { maxLines: 3, textOverflow: "ellipsis" },
  footer: { position: "absolute", bottom: 16, left: 34, right: 34, fontSize: 7, color: "#333", borderTopWidth: 0.5, borderTopColor: "#000", paddingTop: 4 },
});

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const SUMMARY_FOOTER =
  "Patient-generated summary, not a clinical document. The patient chose what to include. It may be out of date and does not replace your own assessment. Entries marked as typed in by the patient have not been checked by a clinician. Records kept in the reproductive health and mental health areas are not included; a medicine or note the patient chose to list is listed whatever it is for.";

const MEDICINE_TAG = {
  signed_prescription: "from a signed prescription",
  patient: "added by the patient",
  other: "in the medicine list, not from a signed prescription",
} as const;

function Tagged({ text, tag }: { text: string; tag?: string }) {
  return (
    <View style={styles.line} wrap={false}>
      <Text style={styles.lineText}>{text}</Text>
      {tag ? <Text style={styles.tag}>{tag}</Text> : null}
    </View>
  );
}

export function BpChartSvg({ chart }: { chart: BpChart }) {
  const { plot } = chart;
  const marker = (p: { x: number; y: number }, kind: "round" | "square", key: string) =>
    kind === "round" ? <Circle key={key} cx={p.x} cy={p.y} r={2.4} fill="#000" /> : <Rect key={key} x={p.x - 2.2} y={p.y - 2.2} width={4.4} height={4.4} fill="#fff" stroke="#000" strokeWidth={1} />;
  const toPoints = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <Svg width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`}>
      <Line x1={plot.left} y1={plot.top} x2={plot.left} y2={plot.bottom} stroke="#000" strokeWidth={0.8} />
      <Line x1={plot.left} y1={plot.bottom} x2={plot.right} y2={plot.bottom} stroke="#000" strokeWidth={0.8} />
      {chart.yTicks.map((t) => (
        <Line key={`g${t.label}`} x1={plot.left} y1={t.y} x2={plot.right} y2={t.y} stroke="#999" strokeWidth={0.3} />
      ))}
      {chart.yTicks.map((t) => (
        <SvgText key={`t${t.label}`} x={plot.left - 4} y={t.y + 2} style={{ fontSize: 7 }} textAnchor="end">{t.label}</SvgText>
      ))}
      {chart.xLabels.map((l, i) => (
        <SvgText key={`x${i}`} x={l.x} y={plot.bottom + 11} style={{ fontSize: 7 }} textAnchor={chart.xLabels.length === 1 ? "middle" : i === 0 ? "start" : "end"}>{l.label}</SvgText>
      ))}
      {chart.systolic.length > 1 && <Polyline points={toPoints(chart.systolic)} fill="none" stroke="#000" strokeWidth={1.2} />}
      {chart.diastolic.length > 1 && <Polyline points={toPoints(chart.diastolic)} fill="none" stroke="#000" strokeWidth={1.2} strokeDasharray="4 3" />}
      {chart.systolic.map((p, i) => marker(p, "round", `s${i}`))}
      {chart.diastolic.map((p, i) => marker(p, "square", `d${i}`))}
      {/* the key, in words and in the same line and marker styles */}
      <Line x1={plot.left + 8} y1={chart.height - 6} x2={plot.left + 30} y2={chart.height - 6} stroke="#000" strokeWidth={1.2} />
      <Circle cx={plot.left + 19} cy={chart.height - 6} r={2.4} fill="#000" />
      <SvgText x={plot.left + 34} y={chart.height - 3.5} style={{ fontSize: 7 }}>Systolic (top number): solid line, round marker</SvgText>
      <Line x1={plot.left + 190} y1={chart.height - 6} x2={plot.left + 212} y2={chart.height - 6} stroke="#000" strokeWidth={1.2} strokeDasharray="4 3" />
      <Rect x={plot.left + 199} y={chart.height - 8.2} width={4.4} height={4.4} fill="#fff" stroke="#000" strokeWidth={1} />
      <SvgText x={plot.left + 216} y={chart.height - 3.5} style={{ fontSize: 7 }}>Diastolic (bottom number): dashed line, square marker</SvgText>
    </Svg>
  );
}

export function DoctorSummaryPdfDocument({ data }: { data: DoctorSummaryData }) {
  const p = data.patient;
  const has = (k: string) => (data.sections as readonly string[]).includes(k);
  const generated = new Date(data.generatedAtMs).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
  return (
    <Document title={`Visit summary - ${p.name}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <View>
            <Text style={styles.title}>Patient summary for a visit</Text>
            <Text style={styles.small}>
              Prepared by the patient through TarragonHealth on {generated}. Covers the last {data.days} days (from {day(data.sinceDate)}).
            </Text>
          </View>
          <Text style={styles.small}>{PDF_CONTACT_EMAIL}</Text>
        </View>

        <View style={styles.idRow}>
          <Text style={{ fontWeight: 700 }}>{p.name}</Text>
          {p.dateOfBirth && <Text>Born {date(p.dateOfBirth)}</Text>}
          {p.sex && <Text>Sex {p.sex}</Text>}
          {p.patientNumber && <Text>No. {p.patientNumber}</Text>}
        </View>

        {has("allergies_conditions") && data.allergiesConditions && (
          <View>
            <Text style={styles.sectionTitle}>Allergies</Text>
            {data.allergiesConditions.allergies.length === 0 ? (
              <Text style={styles.small}>None recorded</Text>
            ) : (
              data.allergiesConditions.allergies.map((a, i) => (
                <Tagged key={i} text={`${a.allergen}${a.provenance === "ruled_out" ? " (ruled out by a clinician)" : ""}${a.detail ? `: ${a.detail}` : ""}`} tag={ALLERGY_SOURCE_LABEL[a.provenance]} />
              ))
            )}
            <Text style={styles.sectionTitle}>Ongoing conditions</Text>
            {data.allergiesConditions.conditions.length === 0 ? (
              <Text style={styles.small}>None recorded</Text>
            ) : (
              data.allergiesConditions.conditions.map((c) => (
                <Tagged key={c} text={c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase())} tag="from the patient's care plan" />
              ))
            )}
          </View>
        )}

        {has("bp") && data.bp && (
          <View>
            <Text style={styles.sectionTitle}>Blood pressure readings</Text>
            {data.bp.totalListed === 0 ? (
              <Text style={styles.small}>No readings in this period</Text>
            ) : (
              <View>
                <View style={styles.box} wrap={false}>
                  {data.bp.average ? (
                    <Text>
                      Average of {data.bp.average.count} home cuff and typed readings: {data.bp.average.systolic}/{data.bp.average.diastolic} mmHg
                    </Text>
                  ) : (
                    <Text>No home cuff or typed readings in this period, so there is no average.</Text>
                  )}
                  {data.bp.excludedFromAverage > 0 && (
                    <Text style={styles.small}>
                      {data.bp.excludedFromAverage} reading{data.bp.excludedFromAverage === 1 ? "" : "s"} from a wearable or another record {data.bp.excludedFromAverage === 1 ? "is" : "are"} listed below but not in the average.
                    </Text>
                  )}
                </View>
                {data.bp.lines.map((l, i) => (
                  <Tagged key={i} text={`${dateTime(l.takenAt)}   ${l.systolic}/${l.diastolic} mmHg${l.pulse ? `, pulse ${l.pulse}` : ""}`} tag={BP_SOURCE_LABEL[l.trust]} />
                ))}
                {data.bp.truncated && <Text style={styles.small}>Showing the latest {data.bp.lines.length} of {data.bp.totalListed} readings.</Text>}
              </View>
            )}
            {data.bp.capped && <Text style={styles.small}>The app read only the newest readings of each kind, so the average and chart may not cover the whole period.</Text>}
            {data.bp.notCounted > 0 && <Text style={styles.small}>{data.bp.notCounted} reading{data.bp.notCounted === 1 ? "" : "s"} not counted because the app could not confirm {data.bp.notCounted === 1 ? "it" : "them"}.</Text>}
          </View>
        )}

        {has("bp_chart") && (
          <View wrap={false}>
            <Text style={styles.sectionTitle}>Blood pressure over time</Text>
            {data.chart ? (
              <View>
                <BpChartSvg chart={data.chart} />
                <Text style={styles.small}>Home cuff and typed readings only; wearable readings are not drawn. Numbers on the left are mmHg.</Text>
              </View>
            ) : (
              <Text style={styles.small}>No home cuff or typed readings in this period to draw</Text>
            )}
          </View>
        )}

        {has("medicines") && data.medicines && (
          <View>
            <Text style={styles.sectionTitle}>Current medicines and schedule</Text>
            {data.medicines.length === 0 ? (
              <Text style={styles.small}>None recorded</Text>
            ) : (
              data.medicines.map((m, i) => (
                <Tagged key={i} text={`${m.name}${m.dose ? `, ${m.dose}` : ""}: ${m.schedule}`} tag={MEDICINE_TAG[m.provenance]} />
              ))
            )}
          </View>
        )}

        {has("adherence") && data.adherence && (
          <View>
            <Text style={styles.sectionTitle}>Medicine doses marked taken, by week</Text>
            {data.adherence.hasScheduledMedicines ? (
              <View>
                {data.adherence.weeks.map((w) => (
                  <Tagged
                    key={w.weekStart}
                    text={`${day(w.weekStart)} to ${day(w.weekEnd)}:  ${w.percent === null ? "too few doses due to give a percentage" : `${w.percent}% (${w.markedTaken} of ${w.due} doses)`};  skipped ${w.skipped}, no record ${w.noRecord}, could not get ${w.couldNotGet}`}
                  />
                ))}
                <Text style={styles.small}>
                  This is what the patient marked in the app: doses marked taken (on time or late) out of doses due, as-needed medicines left out. Whole weeks ending yesterday, all inside the period chosen. A percentage is shown only when at least {data.adherence.minDoses} doses were due.
                </Text>
              </View>
            ) : (
              <Text style={styles.small}>No scheduled doses were due in this period</Text>
            )}
          </View>
        )}

        {has("skipped") && data.skipped && (
          <View>
            <Text style={styles.sectionTitle}>Skipped doses and why</Text>
            {data.skipped.lines.length === 0 ? (
              <Text style={styles.small}>No doses were marked skipped in this period</Text>
            ) : (
              <View>
                {data.skipped.lines.map((s, i) => (
                  <Tagged key={i} text={`${s.when}   ${s.medicine}: ${s.reason}`} tag="logged in the app" />
                ))}
                {data.skipped.capped && <Text style={styles.small}>Only the newest 500 skipped doses were read, so the count above may be too low.</Text>}
                {data.skipped.total > data.skipped.lines.length && <Text style={styles.small}>Showing the latest {data.skipped.lines.length} of {data.skipped.total}.</Text>}
              </View>
            )}
          </View>
        )}

        {has("symptoms") && data.symptoms && (
          <View>
            <Text style={styles.sectionTitle}>Symptom journal</Text>
            {data.symptoms.lines.length === 0 ? (
              <Text style={styles.small}>No entries in this period</Text>
            ) : (
              <View>
                {data.symptoms.lines.map((s, i) => (
                  <View key={i} wrap={false}>
                    <Tagged text={`${dateTime(s.reportedAt)}   ${s.label}${s.severity !== null ? `, severity ${s.severity} (the patient's own scale)` : ""}`} tag="logged in the app" />
                    {s.note ? <Text style={[styles.small, styles.clamp]}>{s.note}</Text> : null}
                  </View>
                ))}
                {data.symptoms.leftOut > 0 && <Text style={styles.small}>{data.symptoms.leftOut} {data.symptoms.leftOut === 1 ? "entry is" : "entries are"} not shown here.</Text>}
                {data.symptoms.capped && <Text style={styles.small}>Only the newest 500 journal entries were read, so older entries in this period may be missing.</Text>}
                {data.symptoms.total > data.symptoms.lines.length && <Text style={styles.small}>Showing the latest {data.symptoms.lines.length} of {data.symptoms.total}.</Text>}
              </View>
            )}
          </View>
        )}

        <Text style={styles.footer} fixed>
          {SUMMARY_FOOTER}
        </Text>
      </Page>
    </Document>
  );
}
