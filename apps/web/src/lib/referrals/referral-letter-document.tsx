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

export interface ReferralVital {
  vital_type: string;
  systolic?: number | null;
  diastolic?: number | null;
  glucose_mmol_l?: number | null;
  pulse_bpm?: number | null;
  weight_kg?: number | null;
  spo2_pct?: number | null;
  taken_at: string;
}

export interface ReferralLetterData {
  patientName: string;
  patientNumber: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  referralNumber: string | null;
  createdAt: string;
  specialistType: string;
  urgency: string | null;
  reason: string | null;
  requestedService: string | null;
  interimPlan: string | null;
  vitals: ReferralVital[];
  medications: {
    drug_name: string;
    dose: string | null;
    frequency: string | null;
  }[];
  triggeringResult: {
    result_status?: string | null;
    result_summary?: string | null;
    created_at?: string | null;
  } | null;
  /** Null unless a real clinical_staff row backs it. Never a placeholder. */
  referrerName: string | null;
  /**
   * The register a credential is on, read from clinical_staff rather than
   * assumed. MDCN and NMCN are both real here, and printing the wrong register
   * at a specialist is a misstatement, so the register is never inferred — no
   * type, no claim. Matches the health passport and vaccination certificate,
   * which already read credential_type this way.
   */
  referrerCredentialType: string | null;
  referrerCredential: string | null;
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
  subtitle: { fontSize: 9.5, color: "#5b6b78", marginBottom: 14 },

  urgent: {
    fontSize: 10,
    fontWeight: 700,
    color: "#B3261E",
    marginBottom: 12,
    padding: 8,
    backgroundColor: "#FBEAE9",
    borderLeftWidth: 3,
    borderLeftColor: "#B3261E",
  },

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
  line: {
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dfe3e6",
  },
  muted: { color: "#5b6b78" },

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

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * The practitioner noun for a specialist_type, because the letter addresses a
 * person: "any cardiologist the patient chooses", not "any cardiology". An
 * unmapped value falls back to humanise, so a new enum member degrades to
 * readable text rather than printing a raw underscored code at a specialist.
 */
const SPECIALIST_NOUN: Record<string, string> = {
  urologist: "urologist",
  oncologist: "oncologist",
  ob_gyn: "OB-GYN",
  cardiology: "cardiologist",
  endocrinology: "endocrinologist",
  nephrology: "nephrologist",
  ophthalmology: "ophthalmologist",
  dietetics: "dietitian",
  podiatry: "podiatrist",
  psychiatry: "psychiatrist",
  psychology: "psychologist",
  other: "specialist",
};

function specialistNoun(value: string): string {
  return SPECIALIST_NOUN[value] ?? humanise(value);
}

function vitalLine(v: ReferralVital): string {
  const on = new Date(v.taken_at).toLocaleDateString("en-GB");
  switch (v.vital_type) {
    case "blood_pressure":
      return `Blood pressure ${v.systolic}/${v.diastolic} mmHg (${on})`;
    case "glucose":
      return `Glucose ${v.glucose_mmol_l} mmol/L (${on})`;
    case "pulse":
      return `Pulse ${v.pulse_bpm} bpm (${on})`;
    case "weight":
      return `Weight ${v.weight_kg} kg (${on})`;
    case "spo2":
      return `SpO2 ${v.spo2_pct}% (${on})`;
    default:
      return `${humanise(v.vital_type)} (${on})`;
  }
}

/**
 * The specialist referral letter: what the patient hands over so the specialist
 * knows why they are there and what has already been done.
 *
 * This is the free, clinical referral generated whenever a doctor refers a
 * patient in the ordinary course of care (specialist_referrals) — distinct
 * from the paid Verified Document "Specialist Referral Letter" a patient can
 * separately request (see lib/verified-documents/verified-document.tsx),
 * which is a shorter attestation-style letter for a third party rather than
 * a clinical handover. This one carries the actual clinical detail: recent
 * vitals, current medications, and the result that triggered the referral.
 *
 * This letter names no specialist and quotes no price, because the patient
 * chooses who to see and pays them directly. Attribution is null-gated in
 * the same way as ReviewedByDoctor, so an unassembled referral prints as
 * "TarragonHealth care team" rather than inventing a doctor's name.
 */
export function ReferralLetterDocument({ data }: { data: ReferralLetterData }) {
  const urgent = data.urgency === "urgent" || data.urgency === "emergency";
  return (
    <Document
      title={`TarragonHealth — specialist referral${data.referralNumber ? ` ${data.referralNumber}` : ""}`}
      author="TarragonHealth"
      subject="Specialist referral"
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
            <Text style={styles.headerDocLabel}>Specialist referral</Text>
            {data.referralNumber && (
              <Text style={styles.headerRef}>Ref {data.referralNumber}</Text>
            )}
          </View>
        </View>
        <View style={styles.headerBandAccent} fixed />

        <Text style={styles.title}>Specialist referral</Text>
        <Text style={styles.subtitle}>
          Written {formatDate(data.createdAt)}
        </Text>

        {urgent && (
          <Text style={styles.urgent}>
            {String(data.urgency).toUpperCase()}: please prioritise this
            patient.
          </Text>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            To: any {specialistNoun(data.specialistType)} the patient chooses
          </Text>
          <Text style={styles.muted}>
            This patient has not been booked with a named specialist. They are
            free to attend whichever clinic suits them and will settle that
            clinic&apos;s fee directly.
          </Text>
        </View>

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
          <Text style={styles.sectionTitle}>Reason for referral</Text>
          <Text>{data.reason ?? "Referred for specialist assessment."}</Text>
        </View>

        {data.requestedService && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Requested service</Text>
            <Text>{data.requestedService}</Text>
          </View>
        )}

        {data.triggeringResult && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Result that prompted this</Text>
            <Text>
              {data.triggeringResult.result_summary ??
                "Abnormal screening result"}
              {data.triggeringResult.result_status
                ? ` (${humanise(data.triggeringResult.result_status)})`
                : ""}
              {data.triggeringResult.created_at
                ? `, ${formatDate(data.triggeringResult.created_at)}`
                : ""}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent observations</Text>
          {data.vitals.length > 0 ? (
            data.vitals.map((v, i) => (
              <View
                key={`${v.vital_type}-${v.taken_at}-${i}`}
                style={styles.line}
              >
                <Text>{vitalLine(v)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>None recorded on the platform.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current medication</Text>
          {data.medications.length > 0 ? (
            data.medications.map((m, i) => (
              <View key={`${m.drug_name}-${i}`} style={styles.line}>
                <Text>
                  {m.drug_name}
                  {m.dose ? ` ${m.dose}` : ""}
                  {m.frequency ? `, ${m.frequency}` : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>None recorded on the platform.</Text>
          )}
        </View>

        {data.interimPlan && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What we have done so far</Text>
            <Text>{data.interimPlan}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Referred by</Text>
          {data.referrerName ? (
            <Text>
              {data.referrerName}
              {data.referrerCredentialType && data.referrerCredential
                ? ` (${data.referrerCredentialType} ${data.referrerCredential})`
                : ""}
              , TarragonHealth
            </Text>
          ) : (
            <Text>TarragonHealth care team</Text>
          )}
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>Sending your findings back</Text>
          <Text>
            The patient stays under TarragonHealth for their ongoing monitoring,
            so please give them a copy of your assessment and any plan. They can
            upload it in the app and their care team will act on it, which keeps
            everything on one record rather than split between us.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLine}>
              Observations and medication above are as recorded on
              TarragonHealth on the date shown and may not be exhaustive. This
              letter is a referral for assessment, not a diagnosis or a
              direction on management.
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
