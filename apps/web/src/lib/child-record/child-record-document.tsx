import { Document, Page, Path, Polyline, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { t } from "@tarragon/i18n";
import { layoutGrowthChart, markerPath, type ChartPointInput, type ChecklistDose, type GrowthBand } from "@tarragon/shared";

/**
 * One-page record of a child's growth chart and vaccine record (S68b). Same approach as the school health summary: a printable export the parent
 * hands over, built from the caller's own RLS-scoped reads. Words and shapes, no colour needed: a greyscale print reads the same. kg and cm only.
 * Not a diagnosis; doses a care team has not checked say so ("You told us").
 *
 * react-pdf note: maxLines is a STYLE key, not a prop. A long vaccine name is cut to one line with `style={{ maxLines: 1 }}` so the page never grows to two.
 */
export interface ChildRecordData {
  name: string;
  dateOfBirth: string | null;
  generatedAt: string;
  weightPoints: ChartPointInput[];
  heightPoints: ChartPointInput[];
  latestBand: GrowthBand | null;
  /** The latest result was routed as severe: the page leads with it, whatever else is on it. */
  crisis: boolean;
  doses: ChecklistDose[];
}

const BAND_KEY: Record<GrowthBand, Parameters<typeof t>[0]> = {
  growing_well: "cdl.growth.band_growing_well",
  keep_an_eye_on: "cdl.growth.band_keep_an_eye_on",
  talk_to_care_team: "cdl.growth.band_talk_to_care_team",
};
const STATUS_KEY = { done: "cdl.vax.status_done", due: "cdl.vax.status_due", overdue: "cdl.vax.status_overdue", upcoming: "cdl.vax.status_upcoming" } as const;
const TRUST_KEY = { verified: "cdl.vax.trust_verified", waiting: "cdl.vax.trust_waiting", self_reported: "cdl.vax.trust_self_reported", rejected: "cdl.vax.trust_self_reported" } as const;

const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 9, color: "#12324B", lineHeight: 1.3 },
  brand: { fontSize: 11, fontWeight: 700, color: "#0E7C52" },
  title: { fontSize: 16, fontWeight: 700, marginTop: 4 },
  sub: { fontSize: 9, color: "#555", marginBottom: 8 },
  h: { fontSize: 11, fontWeight: 700, color: "#0E7C52", marginTop: 8, marginBottom: 3 },
  charts: { flexDirection: "row", gap: 8 },
  row: { flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  c1: { width: "40%", maxLines: 1 },
  c2: { width: "10%" },
  c3: { width: "22%" },
  c4: { width: "28%", maxLines: 1 },
  footer: { marginTop: 10, fontSize: 7.5, color: "#777" },
});

function MiniChart({ points, caption }: { points: readonly ChartPointInput[]; caption: string }) {
  const layout = layoutGrowthChart(points, { width: 240, height: 130, pad: 20 });
  return (
    <View style={{ width: "50%" }}>
      <Text style={{ fontSize: 8 }}>{caption}</Text>
      <Svg width={240} height={130} viewBox="0 0 240 130">
        {layout.polyline !== "" && <Polyline points={layout.polyline} fill="none" stroke="#777" strokeWidth={1} />}
        {layout.markers.map((m) => (
          <Path key={m.id} d={markerPath(m.shape, m.x, m.y, 4)} fill={m.band === "growing_well" ? "#FFFFFF" : "#12324B"} stroke="#12324B" strokeWidth={1} />
        ))}
      </Svg>
    </View>
  );
}

const day = (iso: string): string => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

export function ChildRecordDocument({ data }: { data: ChildRecordData }) {
  return (
    <Document title={t("cdl.pdf.title")}>
      <Page size="A4" style={styles.page}>
        {data.crisis && <Text style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{t("cdl.crisis.lead")}</Text>}
        <Text style={styles.brand}>TarragonHealth</Text>
        <Text style={styles.title}>{t("cdl.pdf.title")}</Text>
        <Text style={styles.sub}>
          {t("cdl.pdf.name")}: {data.name}   {t("cdl.pdf.dob")}: {data.dateOfBirth ? day(data.dateOfBirth) : "-"}
        </Text>

        <Text style={styles.h}>{t("cdl.pdf.growth")}</Text>
        {data.weightPoints.length === 0 && data.heightPoints.length === 0 ? (
          <Text>{t("cdl.pdf.no_growth")}</Text>
        ) : (
          <>
            {data.latestBand && <Text style={{ fontSize: 11, fontWeight: 700 }}>{t(BAND_KEY[data.latestBand])}</Text>}
            <View style={styles.charts}>
              <MiniChart points={data.weightPoints} caption={`${t("cdl.growth.weight_axis")} / ${t("cdl.growth.age_axis")}`} />
              <MiniChart points={data.heightPoints} caption={`${t("cdl.growth.height_axis")} / ${t("cdl.growth.age_axis")}`} />
            </View>
            <Text style={{ fontSize: 7.5 }}>{t("cdl.growth.shape_circle")}. {t("cdl.growth.shape_diamond")}. {t("cdl.growth.shape_triangle")}.</Text>
          </>
        )}

        <Text style={styles.h}>{t("cdl.pdf.vaccines")}</Text>
        {data.doses.length === 0 ? (
          <Text>{t("cdl.pdf.no_vaccines")}</Text>
        ) : (
          data.doses.map((d) => (
            <View key={`${d.code}-${d.doseNumber}`} style={styles.row} wrap={false}>
              <Text style={styles.c1}>{d.name}</Text>
              <Text style={styles.c2}>{d.doseNumber}</Text>
              <Text style={styles.c3}>{t(STATUS_KEY[d.status])}</Text>
              <Text style={styles.c4}>{d.doneOn ? `${day(d.doneOn)}${d.trust ? `, ${t(TRUST_KEY[d.trust])}` : ""}` : day(d.dueDate)}</Text>
            </View>
          ))
        )}
        <Text style={styles.footer}>{t("cdl.pdf.footer", "en", { date: day(data.generatedAt) })}</Text>
      </Page>
    </Document>
  );
}
