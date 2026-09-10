import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Enums } from "@tarragon/shared";
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

export interface VerifiedDocumentData {
  patientName: string;
  patientNumber: string | null;
  dateOfBirth: string | null;
  documentType: Enums<"verified_document_type">;
  documentId: string;
  attestationText: string;
  validFrom: string;
  validUntil: string | null;
  issuedAt: string;
  /** Null unless a real clinical_staff row backs it — same rule as the
   * referral letter and ReviewedByDoctor: never a placeholder name. */
  issuerName: string | null;
  issuerCredentialType: string | null;
  issuerCredential: string | null;
}

/**
 * A4 letterhead geometry, identical to lab-request-document.tsx — one visual
 * system across every TarragonHealth-issued PDF, not a per-document style.
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

  callout: {
    marginTop: 4,
    padding: 10,
    backgroundColor: "#EEF6F1",
    borderLeftWidth: 3,
    borderLeftColor: PDF_BRAND_GREEN,
  },

  // The signature block is styled distinctly from the tabular sections above
  // it — a top rule standing in for a physical signature line, and the
  // credential/date set as a caption underneath — because this is the one
  // place on the page a reader looks for "who actually signed this."
  signatureBlock: { marginTop: 6, marginBottom: 14 },
  signatureRule: {
    borderTopWidth: 0.75,
    borderTopColor: PDF_CLINICAL_NAVY,
    width: 220,
    marginBottom: 6,
  },
  signatureName: { fontSize: 11, fontWeight: 700, color: PDF_CLINICAL_NAVY },
  signatureCaption: { fontSize: 8.5, color: "#5b6b78", marginTop: 1 },

  scopeBox: {
    marginTop: 4,
    padding: 10,
    backgroundColor: "#F4F1EA",
    borderLeftWidth: 3,
    borderLeftColor: PDF_CLINICAL_NAVY,
  },
  scopeText: { fontSize: 8.5, color: "#5b6b78", lineHeight: 1.4 },

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

/** Typed off the enum, not a hand-written union, so adding a document type
 * fails the build here rather than rendering an untitled PDF. */
const DOCUMENT_TITLE: Record<VerifiedDocumentData["documentType"], string> = {
  fit_to_work: "Fitness-to-Work Letter",
  return_to_work: "Return-to-Work Letter",
  travel_health_certificate: "Travel Health Letter",
  medication_carry_letter: "Medication Carry Letter",
  specialist_referral_letter: "Specialist Referral Letter",
  school_health_form: "School Health Summary",
  insurance_medical_summary: "Insurance Medical Summary",
};

/**
 * The scope statement printed on the face of every document.
 *
 * This is the medicolegal core of the product, not a disclaimer bolted on. A
 * doctor issuing any of these has reviewed a record remotely and has NOT
 * examined the person, and the recipient has to be able to see that. It also
 * says plainly what the document is not valid for.
 *
 * Nigerian pre-employment medicals require physical examination -- vitals taken
 * by the examiner, and in several sectors a chest radiograph -- and visa
 * medicals must come from a panel physician designated by the destination
 * country. Tarragon does not and must not issue either. Do not add a type here
 * that implies otherwise, and do not soften this paragraph: it is the sentence
 * that makes the rest of the document defensible.
 */
const SCOPE_STATEMENT =
  "This document is based on a remote review of the health record TarragonHealth holds for this patient. No physical examination was performed. It is not a pre-employment medical examination, an immigration or visa medical, or a substitute for either, and it should not be accepted as one.";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Every paid Verified Document (fit-to-work, travel health, medication carry,
 * specialist referral, school health, insurance summary) — one letterhead so
 * a recipient who has seen one TarragonHealth document recognises the next.
 * This is the one type in the family a patient hands to a third party
 * (employer, insurer, embassy, school), which is exactly why it earns the
 * same production values as the take-anywhere lab request rather than a
 * plainer internal-looking export.
 *
 * The plain, proven signed-PDF pattern (same shape as ReferralLetterDocument
 * / HealthPassportDocument) — not the separate, unwired Ed25519 verifiable-
 * credential system. Attestation attribution is null-gated exactly like
 * ReviewedByDoctor: an issuer without a real clinical_staff match prints as
 * "TarragonHealth care team", never a fabricated name.
 */
export function VerifiedDocumentPdf({ data }: { data: VerifiedDocumentData }) {
  const issuer = data.issuerName
    ? `Dr. ${data.issuerName}`
    : "TarragonHealth care team";
  const credential =
    data.issuerCredentialType && data.issuerCredential
      ? `${data.issuerCredentialType} ${data.issuerCredential}`
      : null;
  const refCode = data.documentId.slice(0, 8).toUpperCase();

  return (
    <Document
      title={`TarragonHealth — ${DOCUMENT_TITLE[data.documentType]}`}
      author="TarragonHealth"
      subject={DOCUMENT_TITLE[data.documentType]}
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
            <Text style={styles.headerDocLabel}>
              {DOCUMENT_TITLE[data.documentType]}
            </Text>
            <Text style={styles.headerRef}>Ref {refCode}</Text>
          </View>
        </View>
        <View style={styles.headerBandAccent} fixed />

        <Text style={styles.title}>{DOCUMENT_TITLE[data.documentType]}</Text>
        <Text style={styles.subtitle}>Issued {formatDate(data.issuedAt)}</Text>

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
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attestation</Text>
          <View style={styles.callout}>
            <Text>{data.attestationText}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Validity</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Valid from</Text>
            <Text>{formatDate(data.validFrom)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Valid until</Text>
            <Text>
              {data.validUntil
                ? formatDate(data.validUntil)
                : "Not time-limited"}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Signed by</Text>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureRule} />
            <Text style={styles.signatureName}>{issuer}</Text>
            {credential && (
              <Text style={styles.signatureCaption}>{credential}</Text>
            )}
            <Text style={styles.signatureCaption}>
              {formatDate(data.issuedAt)}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basis and scope</Text>
          <View style={styles.scopeBox}>
            <Text style={styles.scopeText}>{SCOPE_STATEMENT}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLine}>
              To confirm this document is genuine, verify reference {refCode} at
              tarragonhealth.ng/verify. A document that cannot be verified there
              was not issued by us.
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
