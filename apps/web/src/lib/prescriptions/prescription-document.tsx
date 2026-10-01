import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import {
  PDF_LOGO_SRC,
  PDF_CONTACT_EMAIL,
  PDF_CONTACT_PHONE,
  PDF_BRAND_GREEN,
  PDF_CLINICAL_NAVY,
} from "@/lib/pdf/pdf-brand";
import type { PrescriptionPdfData, SkippedPrescription } from "./prescription-pdf-data";
import { DEFAULT_LETTERHEAD, type Letterhead } from "./letterhead";
import { prescriptionVerifyUrl } from "./verify-url";

registerPdfFonts();

const PAGE_PADDING = 36;

const styles = StyleSheet.create({
  page: {
    fontSize: 10,
    color: PDF_CLINICAL_NAVY,
    fontFamily: PDF_FONT_FAMILY,
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: PAGE_PADDING,
  },

  // Letterhead: logo, company name, registered details. A pharmacist looks here first to see who issued this.
  letterhead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: PDF_BRAND_GREEN },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  logo: { width: 44, height: 44 },
  brandCol: { flexDirection: "column", flex: 1 },
  brandWordmark: { fontSize: 20, fontWeight: 700, color: PDF_CLINICAL_NAVY },
  legalLine: { fontSize: 8.5, color: "#44525f", marginTop: 1 },
  contactLine: { fontSize: 8, color: "#5b6b78", marginTop: 1 },
  titleCol: { flexDirection: "column", alignItems: "flex-end", maxWidth: 170 },
  docTitle: { fontSize: 15, fontWeight: 700, color: PDF_BRAND_GREEN, letterSpacing: 1 },
  docMeta: { fontSize: 9, color: "#44525f", marginTop: 2 },

  label: { fontSize: 7.5, color: "#5b6b78", textTransform: "uppercase", letterSpacing: 0.5 },
  value: { fontSize: 10.5, fontWeight: 700, marginTop: 1 },

  patientBox: { flexDirection: "row", marginTop: 10, padding: 8, borderWidth: 0.75, borderColor: "#c9d2d8", borderRadius: 3, gap: 8 },
  patientCell: { flexGrow: 1, flexBasis: 0 },
  patientCellWide: { flexGrow: 1.6, flexBasis: 0 },

  rxRow: { flexDirection: "row", marginTop: 10, gap: 12 },
  rxMark: { fontSize: 34, fontWeight: 700, color: PDF_BRAND_GREEN, width: 56 },
  rxBody: { flex: 1 },
  drugName: { fontSize: 19, fontWeight: 700 },
  strength: { fontSize: 13, marginTop: 2 },
  sig: { fontSize: 12.5, marginTop: 6, fontWeight: 700 },
  detailRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#dfe3e6" },
  detailLabel: { width: 110, color: "#5b6b78", fontSize: 10 },
  detailValue: { flex: 1, fontSize: 10.5 },

  signRow: { flexDirection: "row", marginTop: 10, gap: 18, alignItems: "flex-end" },
  signLeft: { flex: 1 },
  signImage: { height: 64, maxWidth: 160, objectFit: "contain", objectPositionX: 0, marginBottom: -2 },
  signLine: { borderTopWidth: 0.75, borderTopColor: PDF_CLINICAL_NAVY, marginTop: 30, paddingTop: 3 },
  signLineWithImage: { borderTopWidth: 0.75, borderTopColor: PDF_CLINICAL_NAVY, marginTop: 0, paddingTop: 3 },
  signCaption: { fontSize: 8, color: "#5b6b78" },
  signName: { fontSize: 11.5, fontWeight: 700, marginTop: 1 },
  signCredential: { fontSize: 9.5, marginTop: 1 },
  stamp: { width: 200, padding: 8, borderWidth: 1.25, borderColor: PDF_BRAND_GREEN, borderRadius: 3 },
  stampTitle: { fontSize: 8, fontWeight: 700, color: PDF_BRAND_GREEN, letterSpacing: 1 },
  stampText: { fontSize: 9, marginTop: 2 },

  notes: { marginTop: 8 },
  noteText: { fontSize: 8, color: "#5b6b78", lineHeight: 1.4 },

  // For a pharmacy that reads the text and sells from it. The check is a second, optional step, small and last.
  pharmacistBox: { flexDirection: "row", gap: 10, marginTop: 8, padding: 8, borderWidth: 0.75, borderColor: "#c9d2d8", borderRadius: 3 },
  pharmacistText: { flex: 1 },
  pharmacistTitle: { fontSize: 8, fontWeight: 700, color: PDF_BRAND_GREEN, letterSpacing: 1, marginBottom: 2 },
  pharmacistLine: { fontSize: 7.8, color: "#44525f", lineHeight: 1.35, marginTop: 1 },
  pharmacistStrong: { fontSize: 8.5, color: PDF_CLINICAL_NAVY, fontWeight: 700 },
  pharmacistLink: { fontSize: 7.2, color: PDF_CLINICAL_NAVY, marginTop: 1 },
  qr: { width: 56, height: 56 },

  footer: { position: "absolute", bottom: 18, left: PAGE_PADDING, right: PAGE_PADDING, flexDirection: "row", justifyContent: "space-between" },
  footerLine: { fontSize: 7, color: "#7a8792" },
  pageNumber: { fontSize: 7, color: "#7a8792" },
  title: { fontSize: 16, fontWeight: 700, marginTop: 14, marginBottom: 2 },
  subtitle: { fontSize: 9.5, color: "#5b6b78", marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#dfe3e6" },
  rowLabel: { color: "#5b6b78" },
  rowValue: { maxWidth: 330, textAlign: "right" },
  section: { marginBottom: 8 },
});

/** Controlled-medicine statement (founder decision 2026-10-01: none is prescribed on the platform, and patients should be told). */
export const NOT_CONTROLLED_STATEMENT =
  "This prescription is not for a controlled medicine. TarragonHealth does not prescribe controlled medicines.";

/** Printed when an older prescription has no quantity or duration. New prescriptions cannot be issued without them. */
export const NOT_SPECIFIED = "Not specified by the prescriber";

/** The optional check, first line of the pharmacist panel: scan or open the link below. */
export const VERIFY_STATEMENT =
  "Optional: scan the code, or open the link below, to confirm this prescription is genuine and still valid.";

/** The no-smartphone route: a person at TarragonHealth answers from the Rx number and verification code. */
export const CONTACT_STATEMENT = "Contact TarragonHealth on";

/** Asks the pharmacy to record the supply, which is what stops the same prescription being filled twice. */
export const RECORD_STATEMENT =
  "Please record each supply on the check page, or note it on this prescription, so it cannot be filled twice.";

/** The address printed as text for a paper copy. The token is the credential, so the whole address is shown. */
export function verifyLinkText(publicToken: string): string {
  return prescriptionVerifyUrl(publicToken).replace(/^https?:\/\//, "");
}

/** How reuse is controlled: pharmacies record each supply and a repeat needs approval. Never claims the prescription is single-use. */
export const REPEAT_STATEMENT =
  "The pharmacy should note each supply on this prescription. A repeat is only available once the care team has approved it. Do not use it at more than one pharmacy for the same supply.";

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

function sexLabel(value: string | null): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function LetterheadBlock({ letterhead, rxNumber, signedAt }: { letterhead: Letterhead; rxNumber: string | null; signedAt: string }) {
  const legal = [letterhead.legalName, letterhead.rcNumber ? `RC ${letterhead.rcNumber}` : null].filter(Boolean).join(" · ");
  const contact = [letterhead.address, letterhead.phone ?? PDF_CONTACT_PHONE, letterhead.email ?? PDF_CONTACT_EMAIL].filter(Boolean).join(" · ");
  return (
    <View style={styles.letterhead}>
      <View style={styles.brandRow}>
        {/* react-pdf's Image is not an HTML <img> — no alt prop exists */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image style={styles.logo} src={PDF_LOGO_SRC} />
        <View style={styles.brandCol}>
          <Text style={styles.brandWordmark}>{letterhead.tradingName}</Text>
          {legal ? <Text style={styles.legalLine}>{legal}</Text> : null}
          <Text style={styles.contactLine}>{contact}</Text>
        </View>
      </View>
      <View style={styles.titleCol}>
        <Text style={styles.docTitle}>PRESCRIPTION</Text>
        {rxNumber ? <Text style={styles.docMeta}>{rxNumber}</Text> : null}
        <Text style={styles.docMeta}>Date: {formatPrescriptionDate(signedAt)}</Text>
      </View>
    </View>
  );
}

function PrescriptionPage({ rx, qr, letterhead }: { rx: PrescriptionPdfData; qr: string | null; letterhead: Letterhead }) {
  const strength = [rx.dose, rx.route].filter(Boolean).join(" · ");
  const age = rx.patientAge !== null ? `${rx.patientAge} years` : null;
  return (
    <Page size="A4" style={styles.page} wrap={false}>
      <LetterheadBlock letterhead={letterhead} rxNumber={rx.rxNumber} signedAt={rx.signedAt} />

      <View style={styles.patientBox}>
        <View style={styles.patientCellWide}>
          <Text style={styles.label}>Patient</Text>
          <Text style={styles.value}>{rx.patientName}</Text>
        </View>
        <View style={styles.patientCell}>
          <Text style={styles.label}>Patient number</Text>
          <Text style={styles.value}>{rx.patientNumber ?? "Not recorded"}</Text>
        </View>
        <View style={styles.patientCellWide}>
          <Text style={styles.label}>Age · Date of birth</Text>
          <Text style={styles.value}>
            {[age, rx.dateOfBirth ? formatPrescriptionDate(rx.dateOfBirth) : null].filter(Boolean).join(" · ") || "Not recorded"}
          </Text>
        </View>
        {sexLabel(rx.patientSex) ? (
          <View style={styles.patientCell}>
            <Text style={styles.label}>Sex</Text>
            <Text style={styles.value}>{sexLabel(rx.patientSex)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.rxRow}>
        <Text style={styles.rxMark}>Rx</Text>
        <View style={styles.rxBody}>
          <Text style={styles.drugName}>{rx.drugName}</Text>
          {strength ? <Text style={styles.strength}>{strength}</Text> : null}
          {rx.frequency ? <Text style={styles.sig}>{rx.frequency}</Text> : null}
          <View style={{ marginTop: 6 }}>
            {/* A prescription from before quantity and duration were required may have neither: say so rather than leave the pharmacy guessing. */}
            <Detail label="Quantity" value={rx.quantity?.trim() ? rx.quantity : NOT_SPECIFIED} />
            <Detail label="Duration" value={formatDuration(rx.durationDays) ?? NOT_SPECIFIED} />
            <Detail label="Repeats allowed" value={String(rx.repeatsAllowed)} />
            <Detail label="Reason" value={rx.indication} />
            <Detail label="Instructions" value={rx.instructions} />
            {rx.amendmentReason ? <Detail label="Changed because" value={rx.amendmentReason} /> : null}
            <Detail label="Valid until" value={formatPrescriptionDate(rx.validUntil)} />
            {rx.version > 1 ? <Detail label="Version" value={`${rx.version}, replaces an earlier prescription`} /> : null}
          </View>
        </View>
      </View>

      <View style={styles.signRow}>
        <View style={styles.signLeft}>
          {rx.signatureImage ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image style={styles.signImage} src={rx.signatureImage} />
          ) : null}
          <View style={rx.signatureImage ? styles.signLineWithImage : styles.signLine}>
            <Text style={styles.signCaption}>Prescriber</Text>
            <Text style={styles.signName}>Dr. {rx.prescriberName}</Text>
            <Text style={styles.signCredential}>{rx.prescriberCredential}</Text>
          </View>
        </View>
        <View style={styles.stamp}>
          <Text style={styles.stampTitle}>ELECTRONICALLY SIGNED</Text>
          <Text style={styles.stampText}>Dr. {rx.prescriberName}</Text>
          <Text style={styles.stampText}>{rx.prescriberCredential}</Text>
          <Text style={styles.stampText}>{formatPrescriptionDate(rx.signedAt, true)}</Text>
        </View>
      </View>

      <View style={styles.notes}>
        <Text style={styles.noteText}>{NOT_CONTROLLED_STATEMENT}</Text>
        <Text style={[styles.noteText, { marginTop: 2 }]}>{REPEAT_STATEMENT}</Text>
      </View>

      <View style={styles.pharmacistBox}>
        {qr ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image style={styles.qr} src={qr} />
        ) : null}
        <View style={styles.pharmacistText}>
          <Text style={styles.pharmacistTitle}>FOR THE PHARMACIST</Text>
          <Text style={styles.pharmacistStrong}>Rx number {rx.rxNumber} · Verification code {rx.verificationCode}</Text>
          <Text style={styles.pharmacistLine}>{VERIFY_STATEMENT}</Text>
          {rx.publicToken ? <Text style={styles.pharmacistLink}>{verifyLinkText(rx.publicToken)}</Text> : null}
          <Text style={styles.pharmacistLine}>
            No smartphone? {CONTACT_STATEMENT} {letterhead.phone ?? PDF_CONTACT_PHONE} or {letterhead.email ?? PDF_CONTACT_EMAIL}, quoting the Rx number and verification code.
          </Text>
          <Text style={styles.pharmacistLine}>{RECORD_STATEMENT}</Text>
        </View>
      </View>

      <View style={styles.footer} fixed>
        <Text style={styles.footerLine}>
          Issued electronically by {letterhead.tradingName}. A personal medical document: keep it private and share it only with your pharmacist.
        </Text>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}

/** Last page of a bundle when a current prescription could not be included: the patient is told, never left to notice a gap. */
function NotIncludedPage({ skipped, letterhead }: { skipped: SkippedPrescription[]; letterhead: Letterhead }) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <LetterheadBlock letterhead={letterhead} rxNumber={null} signedAt={new Date().toISOString()} />
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
  letterhead = DEFAULT_LETTERHEAD,
}: {
  prescriptions: PrescriptionPdfData[];
  skipped?: SkippedPrescription[];
  /** Pre-rendered QR image (data URL) per prescription; a prescription without one prints without a QR. */
  qrByMedicationId?: Record<string, string>;
  letterhead?: Letterhead;
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
        <PrescriptionPage key={rx.medicationId} rx={rx} qr={qrByMedicationId[rx.medicationId] ?? null} letterhead={letterhead} />
      ))}
      {skipped.length > 0 ? <NotIncludedPage skipped={skipped} letterhead={letterhead} /> : null}
    </Document>
  );
}
