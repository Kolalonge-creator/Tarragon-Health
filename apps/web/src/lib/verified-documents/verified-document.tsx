import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Enums } from "@tarragon/shared";

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

const styles = StyleSheet.create({
  page: { padding: 34, fontSize: 10, color: "#12324B", lineHeight: 1.4 },
  brand: { fontSize: 12, fontWeight: 700, color: "#0E7C52" },
  title: { fontSize: 18, fontWeight: 700, lineHeight: 1.2, marginTop: 6, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 14 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 5, color: "#0E7C52" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  callout: {
    marginTop: 6,
    padding: 10,
    backgroundColor: "#F1F7F3",
    borderLeftWidth: 2,
    borderLeftColor: "#0E7C52",
  },
  signature: { marginTop: 24 },
  footer: { marginTop: 18, fontSize: 8, color: "#666" },
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
 * The plain, proven signed-PDF pattern (same shape as ReferralLetterDocument
 * / HealthPassportDocument) — not the separate, unwired Ed25519 verifiable-
 * credential system. Attestation attribution is null-gated exactly like
 * ReviewedByDoctor: an issuer without a real clinical_staff match prints as
 * "TarragonHealth care team", never a fabricated name.
 */
export function VerifiedDocumentPdf({ data }: { data: VerifiedDocumentData }) {
  const issuer = data.issuerName ? `Dr. ${data.issuerName}` : "TarragonHealth care team";
  const credential =
    data.issuerCredentialType && data.issuerCredential
      ? `${data.issuerCredentialType} ${data.issuerCredential}`
      : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>TarragonHealth</Text>
        <Text style={styles.title}>{DOCUMENT_TITLE[data.documentType]}</Text>
        <Text style={styles.subtitle}>
          Document ref {data.documentId.slice(0, 8).toUpperCase()} · Issued {formatDate(data.issuedAt)}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Patient</Text>
          <View style={styles.row}>
            <Text>Name</Text>
            <Text>{data.patientName}</Text>
          </View>
          {data.patientNumber && (
            <View style={styles.row}>
              <Text>Patient number</Text>
              <Text>{data.patientNumber}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text>Date of birth</Text>
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
            <Text>Valid from</Text>
            <Text>{formatDate(data.validFrom)}</Text>
          </View>
          <View style={styles.row}>
            <Text>Valid until</Text>
            <Text>{data.validUntil ? formatDate(data.validUntil) : "Not time-limited"}</Text>
          </View>
        </View>

        <View style={styles.signature}>
          <Text>{issuer}</Text>
          {credential && <Text style={{ color: "#555" }}>{credential}</Text>}
          <Text style={{ color: "#555" }}>{formatDate(data.issuedAt)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basis and scope</Text>
          <Text style={{ color: "#555" }}>{SCOPE_STATEMENT}</Text>
        </View>

        <Text style={styles.footer}>
          Issued by TarragonHealth. To confirm this document is genuine, verify the reference above
          at tarragonhealth.ng/verify. A document that cannot be verified there was not issued by us.
        </Text>
      </Page>
    </Document>
  );
}
