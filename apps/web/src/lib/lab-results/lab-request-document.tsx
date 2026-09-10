import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
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

export interface LabRequestData {
  patientName: string;
  patientNumber: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  orderNumber: string | null;
  orderedAt: string;
  panelName: string;
  panelDescription: string | null;
  /** Resolved display names for the bundle's test_codes, in catalogue order. */
  testNames: string[];
  /** Null for a patient-initiated preventive request. */
  requestedByName: string | null;
  /**
   * The register a credential is on, read from clinical_staff rather than
   * assumed. MDCN and NMCN are both real here, and printing the wrong register
   * on a clinical document is a misstatement, so the register is never inferred
   * — no type, no claim. Matches the health passport and vaccination
   * certificate, which already read credential_type this way.
   */
  requestedByCredentialType: string | null;
  requestedByCredentialNumber: string | null;
  /**
   * The clinical reason a doctor recorded when they generated this request
   * (lab_orders.clinical_indication), null for a patient-initiated
   * preventive request. When present this is the most authoritative "why" on
   * the document and is given its own section, ahead of the generic
   * screening-calendar explanation.
   */
  clinicalIndication: string | null;
}

/**
 * A4 letterhead geometry. Everything below the coloured header band sits
 * inside a consistent side margin so multi-page requests (a large panel
 * whose test list wraps) keep the same left/right edge on every page — the
 * header itself is `fixed`, so it repeats identically on each page rather
 * than only appearing once at the top of page one.
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

  // The letterhead band. A genuine coloured masthead rather than a logo
  // floating on white — this is what makes the document read as issued
  // stationery rather than an app export, and it is `fixed` so a second page
  // (a long panel) carries the same header, not a blank continuation sheet.
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

  title: { fontSize: 18, fontWeight: 700, marginBottom: 3, color: PDF_CLINICAL_NAVY },
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
  testRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dfe3e6",
  },
  testBullet: { width: 10, color: PDF_BRAND_GREEN, fontWeight: 700 },
  muted: { color: "#5b6b78" },

  callout: {
    marginTop: 4,
    padding: 10,
    backgroundColor: "#EEF6F1",
    borderLeftWidth: 3,
    borderLeftColor: PDF_BRAND_GREEN,
  },
  calloutTitle: { fontWeight: 700, marginBottom: 3, color: PDF_CLINICAL_NAVY },

  reasonBox: {
    marginTop: 4,
    padding: 10,
    backgroundColor: "#F4F1EA",
    borderLeftWidth: 3,
    borderLeftColor: PDF_CLINICAL_NAVY,
  },

  // Footer is `fixed` (repeats on every page) and pinned to the bottom via
  // absolute positioning rather than document flow, so it never collides
  // with a test list that runs long enough to reach the bottom margin —
  // react-pdf lays out flowed content first and only then paints fixed
  // elements, so this is safe regardless of how much content precedes it.
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

/**
 * The take-anywhere test request: the physical artifact that replaces routing
 * a sample to a partner lab. It says WHAT to run and WHY, and nothing about
 * price or where to go, because the patient chooses the laboratory and pays
 * them directly.
 *
 * TWO INVARIANTS THIS DOCUMENT MUST NEVER BREAK, ENFORCED BY WHAT DATA THIS
 * COMPONENT IS EVEN GIVEN (see LabRequestData above and the callers that
 * build it):
 *
 *   1. No price appears anywhere on this page. LabRequestData carries no
 *      price_kobo / indicative_price field at all — there is nothing to
 *      accidentally render. If a future edit adds a price-shaped field here,
 *      that is the moment to stop and ask why, not to print it.
 *   2. No laboratory is named. The patient chooses where to take this, and
 *      naming one on Tarragon-issued stationery would read as a referral
 *      Tarragon has some stake in, which is the exact thing the 2026-09-10
 *      guidance-only decision exists to avoid appearing to do.
 *
 * Deliberately does not name a lab, quote a price, or imply any commercial
 * relationship — Tarragon takes nothing on the test and must not appear to be
 * directing the patient anywhere it benefits from.
 */
export function LabRequestDocument({ data }: { data: LabRequestData }) {
  return (
    <Document
      title={`Tarragon Health — laboratory test request${data.orderNumber ? ` ${data.orderNumber}` : ""}`}
      author="TarragonHealth"
      subject="Laboratory test request"
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Letterhead masthead — fixed so it repeats on every page. */}
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
            <Text style={styles.headerDocLabel}>Laboratory test request</Text>
            {data.orderNumber && <Text style={styles.headerRef}>Ref {data.orderNumber}</Text>}
          </View>
        </View>
        <View style={styles.headerBandAccent} fixed />

        <Text style={styles.title}>Laboratory test request</Text>
        <Text style={styles.subtitle}>Issued {formatDate(data.orderedAt)}</Text>

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
          <Text style={styles.sectionTitle}>Tests requested — {data.panelName}</Text>
          {data.panelDescription && (
            <Text style={[styles.muted, { marginBottom: 6 }]}>{data.panelDescription}</Text>
          )}
          {data.testNames.length > 0 ? (
            data.testNames.map((name) => (
              <View key={name} style={styles.testRow}>
                <Text style={styles.testBullet}>•</Text>
                <Text style={{ flex: 1 }}>{name}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>
              See the panel name above; ask the laboratory for the standard profile.
            </Text>
          )}
        </View>

        {/* The clinical reason, when a doctor recorded one. This is the most
            authoritative "why" this document can carry, so it is a section on
            its own rather than folded into "Requested by" — a laboratory
            technician or the patient themselves should be able to find the
            reason for the request without reading the attribution line. */}
        {data.clinicalIndication && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reason for this request</Text>
            <View style={styles.reasonBox}>
              <Text>{data.clinicalIndication}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Requested by</Text>
          {data.requestedByName ? (
            <Text>
              {data.requestedByName}
              {data.requestedByCredentialType && data.requestedByCredentialNumber
                ? ` (${data.requestedByCredentialType} ${data.requestedByCredentialNumber})`
                : ""}
              , TarragonHealth care team
            </Text>
          ) : (
            <Text style={styles.muted}>
              Requested by the patient through TarragonHealth, as part of the preventive screening
              and monitoring schedule TarragonHealth keeps for them — routine checks recommended for
              their age, sex and health history, not a response to a specific symptom.
            </Text>
          )}
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>For the patient</Text>
          <Text>
            Take this to any registered laboratory you choose. You pay the laboratory directly, at
            their price; TarragonHealth does not take a fee or commission on this test. When you
            get the result, upload it in the app and a doctor will read it with you — including if
            everything is normal.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLine}>
              This request lists the tests recommended for this person on the date shown. It is
              not a prescription, a diagnosis, or a guarantee of any laboratory&apos;s price or
              availability.
            </Text>
            <Text style={styles.footerLine}>
              <Text style={styles.footerBrand}>TarragonHealth</Text> · {PDF_CONTACT_EMAIL} ·{" "}
              {PDF_CONTACT_PHONE}
            </Text>
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
