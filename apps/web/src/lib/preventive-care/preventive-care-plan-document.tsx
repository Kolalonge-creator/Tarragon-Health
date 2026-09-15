import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import {
  PDF_LOGO_SRC,
  PDF_CONTACT_EMAIL,
  PDF_CONTACT_PHONE,
  PDF_TAGLINE,
  PDF_BRAND_GREEN,
  PDF_CLINICAL_NAVY,
} from "@/lib/pdf/pdf-brand";

registerPdfFonts();

export interface PreventiveCareScreeningItem {
  name: string;
  /** screen_types.patient_explainer, falling back to clinical_basis — the
   * plain-language "why" a patient (or a lab technician reading over their
   * shoulder) can actually understand, never the raw clinical_basis jargon
   * alone. */
  reason: string | null;
  dueDate: string;
  overdue: boolean;
  frequencyMonths: number | null;
}

export interface PreventiveCareVaccineItem {
  name: string;
  reason: string | null;
  dueDate: string;
  overdue: boolean;
}

export interface PreventiveCareAnnualHealthCheck {
  year: number;
  status: "pending" | "in_progress" | "completed";
  completionPct: number | null;
  reviewedAt: string | null;
}

export interface PreventiveCarePlanData {
  patientName: string;
  patientNumber: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  generatedAt: string;
  screenings: PreventiveCareScreeningItem[];
  vaccines: PreventiveCareVaccineItem[];
  annualHealthCheck: PreventiveCareAnnualHealthCheck | null;
}

/**
 * A4 letterhead geometry, identical to lab-request-document.tsx — one visual
 * system across every TarragonHealth-issued PDF.
 */
const PAGE_PADDING = 32;
const HEADER_HEIGHT = 74;

const styles = StyleSheet.create({
  page: {
    fontSize: 10,
    color: PDF_CLINICAL_NAVY,
    fontFamily: PDF_FONT_FAMILY,
    paddingTop: HEADER_HEIGHT + 20,
    paddingBottom: 56,
    paddingHorizontal: PAGE_PADDING,
  },

  headerBand: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    backgroundColor: PDF_CLINICAL_NAVY,
    paddingHorizontal: PAGE_PADDING,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBandAccent: {
    position: "absolute",
    top: HEADER_HEIGHT,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: PDF_BRAND_GREEN,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 34, height: 34 },
  brandTextCol: { flexDirection: "column" },
  brandWordmark: { fontSize: 16, fontWeight: 700, color: "#ffffff" },
  brandTagline: { fontSize: 8, color: "#C9D7CF", marginTop: 1 },
  headerRightCol: { flexDirection: "column", alignItems: "flex-end" },
  headerDocLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  headerRef: { fontSize: 8, color: "#C9D7CF", marginTop: 2 },

  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 3,
    color: PDF_CLINICAL_NAVY,
  },
  subtitle: { fontSize: 9.5, color: "#5b6b78", marginBottom: 18 },

  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
    color: PDF_BRAND_GREEN,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dfe3e6",
  },
  rowLabel: { color: "#5b6b78" },
  muted: { color: "#5b6b78" },

  // Each recommendation is a small stacked card rather than a single table
  // row: the reason line often runs to a full sentence ("why"), which reads
  // far better under the item name than squeezed into a second table column.
  itemCard: {
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dfe3e6",
  },
  itemHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  itemName: {
    fontSize: 10.5,
    fontWeight: 700,
    color: PDF_CLINICAL_NAVY,
    flex: 1,
    marginRight: 8,
  },
  itemDue: { fontSize: 8.5, color: "#5b6b78" },
  itemDueOverdue: { fontSize: 8.5, color: "#B3261E", fontWeight: 700 },
  itemReason: { fontSize: 9, color: "#5b6b78", marginTop: 2, lineHeight: 1.35 },

  overdueBadge: {
    fontSize: 7,
    fontWeight: 700,
    color: "#B3261E",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  ahcCard: {
    padding: 10,
    backgroundColor: "#F4F1EA",
    borderLeftWidth: 3,
    borderLeftColor: PDF_CLINICAL_NAVY,
  },
  ahcStatusLine: { fontWeight: 700, marginBottom: 2, color: PDF_CLINICAL_NAVY },

  callout: {
    marginTop: 4,
    padding: 10,
    backgroundColor: "#EEF6F1",
    borderLeftWidth: 3,
    borderLeftColor: PDF_BRAND_GREEN,
  },
  calloutTitle: { fontWeight: 700, marginBottom: 3, color: PDF_CLINICAL_NAVY },

  footer: {
    position: "absolute",
    bottom: 24,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    borderTopWidth: 0.5,
    borderTopColor: "#dfe3e6",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerLeft: { flexDirection: "column", maxWidth: 380 },
  footerLine: { fontSize: 7.5, color: "#7a8792", lineHeight: 1.4 },
  footerBrand: { fontSize: 7.5, color: PDF_BRAND_GREEN, fontWeight: 700 },
  pageNumber: { fontSize: 7.5, color: "#7a8792" },
});

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function dueLabel(dueDate: string, overdue: boolean): string {
  return overdue
    ? `Overdue since ${formatDate(dueDate)}`
    : `Due ${formatDate(dueDate)}`;
}

function frequencyLabel(months: number | null): string | null {
  if (!months) return null;
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1
      ? "Recommended yearly"
      : `Recommended every ${years} years`;
  }
  return `Recommended every ${months} months`;
}

const AHC_STATUS_LABEL: Record<
  PreventiveCareAnnualHealthCheck["status"],
  string
> = {
  pending: "Not yet started",
  in_progress: "In progress",
  completed: "Completed",
};

/**
 * The take-anywhere preventive & chronic-care recommendation: the routine
 * screening, vaccination and Annual Health Check schedule TarragonHealth is
 * keeping for this patient, in one document they can act on at any provider
 * they choose.
 *
 * Aggregates three tables that have no other combined view anywhere on the
 * platform (screening_schedules, vaccination_schedules, annual_health_checks)
 * — see generate-preventive-care-plan-pdf.ts for how each is resolved. ECG is
 * deliberately not a separate section: it is an ordinary screening test
 * (screen_types.code = 'ecg_resting') and appears in "Recommended screening &
 * monitoring" like any other, exactly as it already does on the lab request
 * PDF when actually ordered.
 *
 * SAME TWO INVARIANTS AS THE LAB REQUEST DOCUMENT, enforced the same way — by
 * what data this component is even given:
 *   1. No price appears anywhere. Nothing in PreventiveCarePlanData is
 *      price-shaped.
 *   2. No provider/lab/clinic is named. The patient chooses where to go for
 *      each item, matching the guidance-only model every screening and
 *      vaccination on this platform already runs under.
 */
export function PreventiveCarePlanDocument({
  data,
}: {
  data: PreventiveCarePlanData;
}) {
  const hasAnyDue = data.screenings.length > 0 || data.vaccines.length > 0;
  return (
    <Document
      title="TarragonHealth — preventive & chronic care plan"
      author="TarragonHealth"
      subject="Preventive and chronic care recommendations"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerBand} fixed>
          <View style={styles.brandRow}>
            {/* react-pdf's Image is not an HTML <img> — no alt prop exists */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={PDF_LOGO_SRC} />
            <View style={styles.brandTextCol}>
              <Text style={styles.brandWordmark}>TarragonHealth</Text>
              <Text style={styles.brandTagline}>{PDF_TAGLINE}</Text>
            </View>
          </View>
          <View style={styles.headerRightCol}>
            <Text style={styles.headerDocLabel}>Preventive care plan</Text>
          </View>
        </View>
        <View style={styles.headerBandAccent} fixed />

        <Text style={styles.title}>
          Your preventive &amp; chronic care plan
        </Text>
        <Text style={styles.subtitle}>
          Generated {formatDate(data.generatedAt)}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Patient</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text>{data.patientName}</Text>
          </View>
          {data.patientNumber && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Patient number</Text>
              <Text>{data.patientNumber}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Date of birth</Text>
            <Text>{formatDate(data.dateOfBirth)}</Text>
          </View>
          {data.sex && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Sex</Text>
              <Text style={{ textTransform: "capitalize" }}>{data.sex}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Recommended screening &amp; monitoring
          </Text>
          {data.screenings.length > 0 ? (
            data.screenings.map((item, i) => {
              const freq = frequencyLabel(item.frequencyMonths);
              return (
                <View key={`${item.name}-${i}`} style={styles.itemCard}>
                  <View style={styles.itemHeaderRow}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text
                      style={
                        item.overdue ? styles.itemDueOverdue : styles.itemDue
                      }
                    >
                      {item.overdue ? "OVERDUE · " : ""}
                      {dueLabel(item.dueDate, item.overdue)}
                    </Text>
                  </View>
                  {item.reason && (
                    <Text style={styles.itemReason}>{item.reason}</Text>
                  )}
                  {freq && <Text style={styles.itemReason}>{freq}</Text>}
                </View>
              );
            })
          ) : (
            <Text style={styles.muted}>
              Nothing currently due. TarragonHealth will let you know as your
              next screenings come up.
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vaccines due</Text>
          {data.vaccines.length > 0 ? (
            data.vaccines.map((item, i) => (
              <View key={`${item.name}-${i}`} style={styles.itemCard}>
                <View style={styles.itemHeaderRow}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text
                    style={
                      item.overdue ? styles.itemDueOverdue : styles.itemDue
                    }
                  >
                    {item.overdue ? "OVERDUE · " : ""}
                    {dueLabel(item.dueDate, item.overdue)}
                  </Text>
                </View>
                {item.reason && (
                  <Text style={styles.itemReason}>{item.reason}</Text>
                )}
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No vaccinations currently due.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Annual Health Check</Text>
          {data.annualHealthCheck ? (
            <View style={styles.ahcCard}>
              <Text style={styles.ahcStatusLine}>
                {data.annualHealthCheck.year}:{" "}
                {AHC_STATUS_LABEL[data.annualHealthCheck.status]}
                {data.annualHealthCheck.status === "in_progress" &&
                data.annualHealthCheck.completionPct != null
                  ? ` (${data.annualHealthCheck.completionPct}% complete)`
                  : ""}
              </Text>
              <Text>
                {data.annualHealthCheck.status === "completed"
                  ? `Reviewed${
                      data.annualHealthCheck.reviewedAt
                        ? ` on ${formatDate(data.annualHealthCheck.reviewedAt)}`
                        : ""
                    } by your care team.`
                  : "A yearly review covering routine bloodwork, blood pressure, and a doctor's summary of how your chronic conditions are tracking. Ask your care team to get this started."}
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>
              Not yet started for this year. Ask your care team about your
              Annual Health Check.
            </Text>
          )}
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>For the patient</Text>
          <Text>
            {hasAnyDue
              ? "You can get any of the tests above done at any registered laboratory or clinic you choose. You pay them directly, at their price; TarragonHealth does not take a fee or commission. When you get a result, upload it in the app and a doctor will read it with you."
              : "This is your current preventive care schedule. TarragonHealth will remind you as the next screening or vaccine comes due — there is nothing outstanding right now."}
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLine}>
              This plan reflects the routine screening, vaccination and Annual
              Health Check schedule TarragonHealth keeps for this patient as of
              the date shown. It is not a diagnosis or a response to a specific
              symptom.
            </Text>
            <Text style={styles.footerLine}>
              <Text style={styles.footerBrand}>TarragonHealth</Text> ·{" "}
              {PDF_CONTACT_EMAIL} · {PDF_CONTACT_PHONE}
            </Text>
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
