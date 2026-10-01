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
import type { PrescriptionPdfData, SkippedPrescription } from "./prescription-pdf-data";

registerPdfFonts();

/** Same A4 letterhead geometry as the verified documents and lab request: one visual system across every issued PDF. */
const PAGE_PADDING = 32;
const HEADER_HEIGHT = 74;

const styles = StyleSheet.create({
  page: {
    fontSize: 10,
    color: PDF_CLINICAL_NAVY,
    fontFamily: PDF_FONT_FAMILY,
    paddingTop: HEADER_HEIGHT + 14,
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
  headerBandAccent: { position: "absolute", top: HEADER_HEIGHT, left: 0, right: 0, height: 3, backgroundColor: PDF_BRAND_GREEN },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 34, height: 34 },
  brandTextCol: { flexDirection: "column" },
  brandWordmark: { fontSize: 16, fontWeight: 700, color: "#ffffff" },
  brandTagline: { fontSize: 8, color: "#C9D7CF", marginTop: 1 },
  headerRightCol: { flexDirection: "column", alignItems: "flex-end" },
  headerDocLabel: { fontSize: 9, fontWeight: 700, color: "#ffffff", textTransform: "uppercase", letterSpacing: 1 },
  headerRef: { fontSize: 8, color: "#C9D7CF", marginTop: 2 },

  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 9.5, color: "#5b6b78", marginBottom: 10 },

  section: { marginBottom: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 4,
    color: PDF_BRAND_GREEN,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dfe3e6",
  },
  rowLabel: { color: "#5b6b78" },
  rowValue: { maxWidth: 330, textAlign: "right" },

  drugBox: { padding: 8, backgroundColor: "#EEF6F1", borderLeftWidth: 3, borderLeftColor: PDF_BRAND_GREEN, marginBottom: 6 },
  drugName: { fontSize: 14, fontWeight: 700 },
  drugLine: { fontSize: 10.5, marginTop: 2 },

  codeBox: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: "#F4F1EA", borderLeftWidth: 3, borderLeftColor: PDF_CLINICAL_NAVY },
  codeLabel: { fontSize: 8, color: "#5b6b78", textTransform: "uppercase", letterSpacing: 0.5 },
  codeValue: { fontSize: 14, fontWeight: 700, marginTop: 2, letterSpacing: 1 },

  signatureBlock: { marginTop: 2, marginBottom: 2 },
  signatureRule: { borderTopWidth: 0.75, borderTopColor: PDF_CLINICAL_NAVY, width: 220, marginBottom: 6 },
  signatureName: { fontSize: 11, fontWeight: 700 },
  signatureCaption: { fontSize: 8.5, color: "#5b6b78", marginTop: 1 },

  qrRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  qr: { width: 64, height: 64 },
  qrText: { flex: 1, fontSize: 8.5, color: "#5b6b78", lineHeight: 1.4 },
  noteBox: { marginTop: 4, padding: 10, backgroundColor: "#F4F1EA", borderLeftWidth: 3, borderLeftColor: PDF_CLINICAL_NAVY },
  noteText: { fontSize: 8.5, color: "#5b6b78", lineHeight: 1.4 },

  footer: {
    position: "absolute",
    bottom: 22,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    borderTopWidth: 0.5,
    borderTopColor: "#dfe3e6",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerLeft: { flexDirection: "column", maxWidth: 400 },
  footerLine: { fontSize: 7.5, color: "#7a8792", lineHeight: 1.4 },
  footerBrand: { fontSize: 7.5, color: PDF_BRAND_GREEN, fontWeight: 700 },
  pageNumber: { fontSize: 7.5, color: "#7a8792" },
});

/** Controlled-medicine statement (founder decision 2026-10-01: none is prescribed on the platform, and patients should be told). */
export const NOT_CONTROLLED_STATEMENT =
  "This prescription is not for a controlled medicine. TarragonHealth does not prescribe controlled medicines.";

/** Printed beside the QR code: how a pharmacy checks this prescription with no account. */
export const VERIFY_STATEMENT =
  "Scan to check that this prescription is genuine and still valid. No account is needed. If the check says it is replaced, expired or stopped, do not dispense it.";

/** How reuse is controlled: pharmacies record each supply (phase 3) and a repeat needs approval. Never claims the prescription is single-use. */
export const REPEAT_STATEMENT =
  "The pharmacy records each supply on this prescription (scan the QR). A repeat is only available once the care team has approved it. Do not use it at more than one pharmacy for the same supply.";

export function formatPrescriptionDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatDuration(days: number | null): string | null {
  if (!days || days <= 0) return null;
  return days === 1 ? "1 day" : `${days} days`;
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function PrescriptionPage({ rx, qr }: { rx: PrescriptionPdfData; qr: string | null }) {
  const strength = [rx.dose, rx.route].filter(Boolean).join(" · ");
  return (
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
          <Text style={styles.headerDocLabel}>Prescription</Text>
          <Text style={styles.headerRef}>{rx.rxNumber}</Text>
        </View>
      </View>
      <View style={styles.headerBandAccent} fixed />

      <Text style={styles.title}>Prescription</Text>
      <Text style={styles.subtitle}>
        Signed {formatPrescriptionDate(rx.signedAt)}
        {rx.version > 1 ? ` · Version ${rx.version}, replaces an earlier prescription` : ""}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Patient</Text>
        <Row label="Name" value={rx.patientName} />
        <Row label="Patient number" value={rx.patientNumber} />
        <Row label="Date of birth" value={rx.dateOfBirth ? formatPrescriptionDate(rx.dateOfBirth) : null} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Medicine</Text>
        <View style={styles.drugBox}>
          <Text style={styles.drugName}>{rx.drugName}</Text>
          {strength ? <Text style={styles.drugLine}>{strength}</Text> : null}
          {rx.frequency ? <Text style={styles.drugLine}>{rx.frequency}</Text> : null}
        </View>
        <Row label="Quantity" value={rx.quantity} />
        <Row label="Duration" value={formatDuration(rx.durationDays)} />
        <Row label="Repeats allowed" value={String(rx.repeatsAllowed)} />
        <Row label="Reason" value={rx.indication} />
        <Row label="Instructions" value={rx.instructions} />
        {rx.amendmentReason ? <Row label="Changed because" value={rx.amendmentReason} /> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Check this prescription</Text>
        <View style={styles.codeBox}>
          <View>
            <Text style={styles.codeLabel}>Rx number</Text>
            <Text style={styles.codeValue}>{rx.rxNumber}</Text>
          </View>
          <View>
            <Text style={styles.codeLabel}>Verification code</Text>
            <Text style={styles.codeValue}>{rx.verificationCode}</Text>
          </View>
          <View>
            <Text style={styles.codeLabel}>Valid until</Text>
            <Text style={styles.codeValue}>{formatPrescriptionDate(rx.validUntil)}</Text>
          </View>
        </View>
        {qr ? (
          <View style={styles.qrRow}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.qr} src={qr} />
            <Text style={styles.qrText}>{VERIFY_STATEMENT}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Prescribed by</Text>
        <View style={styles.signatureBlock}>
          <View style={styles.signatureRule} />
          <Text style={styles.signatureName}>Dr. {rx.prescriberName}</Text>
          <Text style={styles.signatureCaption}>{rx.prescriberCredential}</Text>
          <Text style={styles.signatureCaption}>
            Electronically signed {formatPrescriptionDate(rx.signedAt, true)}
          </Text>
        </View>
      </View>

      <View style={styles.noteBox}>
        <Text style={styles.noteText}>{NOT_CONTROLLED_STATEMENT}</Text>
        <Text style={[styles.noteText, { marginTop: 3 }]}>{REPEAT_STATEMENT}</Text>
      </View>

      <View style={styles.footer} fixed>
        <View style={styles.footerLeft}>
          <Text style={styles.footerLine}>
            Issued electronically by TarragonHealth. This is a personal medical document: keep it private and share
            it only with your pharmacist.
          </Text>
          <Text style={styles.footerLine}>
            <Text style={styles.footerBrand}>TarragonHealth</Text> · {PDF_CONTACT_EMAIL} · {PDF_CONTACT_PHONE}
          </Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </Page>
  );
}

/** Last page of a bundle when a current prescription could not be included: the patient is told, never left to notice a gap. */
function NotIncludedPage({ skipped }: { skipped: SkippedPrescription[] }) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <View style={styles.headerBand} fixed>
        <View style={styles.brandRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image style={styles.logo} src={PDF_LOGO_SRC} />
          <View style={styles.brandTextCol}>
            <Text style={styles.brandWordmark}>TarragonHealth</Text>
            <Text style={styles.brandTagline}>{PDF_TAGLINE}</Text>
          </View>
        </View>
        <View style={styles.headerRightCol}>
          <Text style={styles.headerDocLabel}>Not included</Text>
        </View>
      </View>
      <View style={styles.headerBandAccent} fixed />
      <Text style={styles.title}>Not included in this document</Text>
      <Text style={styles.subtitle}>
        These current prescriptions could not be issued as a document. Contact your care team about each one.
      </Text>
      <View style={styles.section}>
        {skipped.map((item, index) => (
          <View key={`${item.drugName}-${index}`} style={styles.row}>
            <Text style={styles.rowLabel}>{item.drugName}</Text>
            <Text style={styles.rowValue}>{item.message}</Text>
          </View>
        ))}
      </View>
    </Page>
  );
}

/**
 * One page per prescription. A single prescription is a one-page document; the bundle (every current
 * prescription for the patient) is one page each, so a pharmacist can separate them and every page still
 * carries its own Rx number, verification code, dose and signature. Anything that could not be included is
 * listed on a final page.
 */
export function PrescriptionPdf({
  prescriptions,
  skipped = [],
  qrByMedicationId = {},
}: {
  prescriptions: PrescriptionPdfData[];
  skipped?: SkippedPrescription[];
  /** Pre-rendered QR image (data URL) per prescription; a prescription without one prints without a QR. */
  qrByMedicationId?: Record<string, string>;
}) {
  const first = prescriptions[0];
  return (
    <Document
      title={
        prescriptions.length === 1 && first
          ? `TarragonHealth prescription ${first.rxNumber}`
          : `TarragonHealth prescriptions (${prescriptions.length})`
      }
      author="TarragonHealth"
      subject="Prescription"
    >
      {prescriptions.map((rx) => (
        <PrescriptionPage key={rx.medicationId} rx={rx} qr={qrByMedicationId[rx.medicationId] ?? null} />
      ))}
      {skipped.length > 0 ? <NotIncludedPage skipped={skipped} /> : null}
    </Document>
  );
}
