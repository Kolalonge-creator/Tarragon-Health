import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { t } from "@tarragon/i18n";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import { PDF_LOGO_SRC, PDF_CONTACT_EMAIL } from "@/lib/pdf/pdf-brand";
import type { AdherenceReportData } from "./adherence-report-data";

registerPdfFonts();

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 64, paddingHorizontal: 44, fontSize: 10, color: "#12324B", fontFamily: PDF_FONT_FAMILY },
  letterhead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20, borderBottomWidth: 1.5, borderBottomColor: "#0E7C52", paddingBottom: 12 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 32, height: 32 },
  brand: { fontSize: 15, fontWeight: 700, color: "#0E7C52" },
  tagline: { fontSize: 8, color: "#666", marginTop: 1 },
  title: { fontSize: 19, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 18, lineHeight: 1.4 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#0E7C52", paddingBottom: 4, marginBottom: 2 },
  row: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: "#e2e2e2" },
  cWeek: { width: "26%" },
  cPct: { width: "20%" },
  cNum: { width: "18%" },
  th: { fontSize: 8, color: "#0E7C52", fontWeight: 700 },
  note: { fontSize: 8.5, color: "#555", lineHeight: 1.45, marginTop: 14 },
  footer: { position: "absolute", bottom: 0, left: 44, right: 44, borderTopWidth: 0.75, borderTopColor: "#0E7C52", paddingTop: 8 },
  footerText: { fontSize: 8, color: "#666" },
});

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The patient's adherence report, "for any facility". English only, strings from the catalogue. It prints what the
 * patient marked, week by week, with skips apart from missed doses, and never a grade, a colour band or a target.
 */
export function AdherenceReportDocument({ patientName, data }: { patientName: string; data: AdherenceReportData }) {
  const generated = new Date(data.generatedAtMs).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" });
  return (
    <Document title={`${t("medicines.report.title")} - ${patientName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.letterhead}>
          <View style={styles.brandRow}>
            {/* react-pdf's Image is not an HTML <img> — no alt prop exists */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={PDF_LOGO_SRC} />
            <View>
              <Text style={styles.brand}>TarragonHealth</Text>
              <Text style={styles.tagline}>Care that stays with you.</Text>
            </View>
          </View>
          <Text style={styles.footerText}>{generated}</Text>
        </View>

        <Text style={styles.title}>{t("medicines.report.title")}</Text>
        <Text style={styles.subtitle}>{t("medicines.report.subtitle", undefined, { name: patientName })}</Text>

        {data.hasScheduledMedicines ? (
          <View>
            <View style={styles.headRow}>
              <Text style={[styles.th, styles.cWeek]}>{t("medicines.report.col_week")}</Text>
              <Text style={[styles.th, styles.cPct]}>{t("medicines.report.col_percent")}</Text>
              <Text style={[styles.th, styles.cNum]}>{t("medicines.report.col_taken")}</Text>
              <Text style={[styles.th, styles.cNum]}>{t("medicines.report.col_skipped")}</Text>
              <Text style={[styles.th, styles.cNum]}>{t("medicines.report.col_no_record")}</Text>
              <Text style={[styles.th, styles.cNum]}>{t("medicines.report.col_could_not_get")}</Text>
            </View>
            {data.weeks.map((w) => (
              <View key={w.weekStart} style={styles.row} wrap={false}>
                <Text style={styles.cWeek}>
                  {day(w.weekStart)} to {day(w.weekEnd)}
                </Text>
                <Text style={styles.cPct}>{w.percent === null ? t("medicines.report.not_enough") : `${w.percent}% (${w.markedTaken} of ${w.due})`}</Text>
                <Text style={styles.cNum}>{w.markedTaken}</Text>
                <Text style={styles.cNum}>{w.skipped}</Text>
                <Text style={styles.cNum}>{w.noRecord}</Text>
                <Text style={styles.cNum}>{w.couldNotGet}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text>{t("medicines.report.none")}</Text>
        )}

        <Text style={styles.note}>{t("medicines.report.footnote_self_report")}</Text>
        <Text style={styles.note}>{t("medicines.report.footnote_definition", undefined, { min: data.minDoses })}</Text>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>TarragonHealth · {PDF_CONTACT_EMAIL}</Text>
        </View>
      </Page>
    </Document>
  );
}
