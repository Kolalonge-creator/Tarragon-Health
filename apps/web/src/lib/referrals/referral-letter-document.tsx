import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

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
  interimPlan: string | null;
  vitals: ReferralVital[];
  medications: { drug_name: string; dose: string | null; frequency: string | null }[];
  triggeringResult: {
    result_status?: string | null;
    result_summary?: string | null;
    created_at?: string | null;
  } | null;
  /** Null unless a real clinical_staff row backs it. Never a placeholder. */
  referrerName: string | null;
  referrerCredential: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 34, fontSize: 10, color: "#12324B", lineHeight: 1.4 },
  brand: { fontSize: 12, fontWeight: 700, color: "#0E7C52" },
  // lineHeight is set explicitly because the page sets 1.4 for body copy, and
  // inheriting that on an 18pt heading makes its line box overlap the subtitle
  // beneath it. Matches the lab request document's heading spacing.
  title: { fontSize: 18, fontWeight: 700, lineHeight: 1.2, marginTop: 6, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 14 },
  urgent: { fontSize: 11, fontWeight: 700, color: "#B3261E", marginBottom: 10 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 5, color: "#0E7C52" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  line: { paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  muted: { color: "#666" },
  callout: {
    marginTop: 6,
    padding: 8,
    backgroundColor: "#F1F7F3",
    borderLeftWidth: 2,
    borderLeftColor: "#0E7C52",
  },
  footer: { marginTop: 18, fontSize: 8, color: "#666" },
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
 * This is the part of a referral that actually matters clinically, and it is
 * deliberately kept now that Tarragon no longer books specialists or takes a
 * fee on one. It names no specialist and quotes no price, because the patient
 * chooses who to see and pays them directly.
 *
 * Every clinical statement here comes from the record: recent vitals, current
 * medications, and the result that triggered the referral. Attribution is
 * null-gated in the same way as ReviewedByDoctor, so an unassembled referral
 * prints as "TarragonHealth care team" rather than inventing a doctor's name.
 */
export function ReferralLetterDocument({ data }: { data: ReferralLetterData }) {
  const urgent = data.urgency === "urgent" || data.urgency === "emergency";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>TarragonHealth</Text>
        <Text style={styles.title}>Specialist referral</Text>
        <Text style={styles.subtitle}>
          {data.referralNumber ? `${data.referralNumber} · ` : ""}
          Written {formatDate(data.createdAt)}
        </Text>

        {urgent && (
          <Text style={styles.urgent}>
            {String(data.urgency).toUpperCase()}: please prioritise this patient.
          </Text>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            To: any {specialistNoun(data.specialistType)} the patient chooses
          </Text>
          <Text style={styles.muted}>
            This patient has not been booked with a named specialist. They are free to attend
            whichever clinic suits them and will settle that clinic&apos;s fee directly.
          </Text>
        </View>

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
          {data.sex && (
            <View style={styles.row}>
              <Text>Sex</Text>
              <Text>{data.sex}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reason for referral</Text>
          <Text>{data.reason ?? "Referred for specialist assessment."}</Text>
        </View>

        {data.triggeringResult && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Result that prompted this</Text>
            <Text>
              {data.triggeringResult.result_summary ?? "Abnormal screening result"}
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
              <View key={`${v.vital_type}-${v.taken_at}-${i}`} style={styles.line}>
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
              {data.referrerCredential ? ` (MDCN ${data.referrerCredential})` : ""}, TarragonHealth
            </Text>
          ) : (
            <Text>TarragonHealth care team</Text>
          )}
        </View>

        <View style={styles.callout}>
          <Text style={{ fontWeight: 700, marginBottom: 3 }}>Sending your findings back</Text>
          <Text>
            The patient stays under TarragonHealth for their ongoing monitoring, so please give
            them a copy of your assessment and any plan. They can upload it in the app and their
            care team will act on it, which keeps everything on one record rather than split
            between us.
          </Text>
        </View>

        <Text style={styles.footer}>
          Observations and medication above are as recorded on TarragonHealth on the date shown and
          may not be exhaustive. This letter is a referral for assessment, not a diagnosis or a
          direction on management.
        </Text>
      </Page>
    </Document>
  );
}
