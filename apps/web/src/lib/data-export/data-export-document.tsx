import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts, PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";
import { PDF_CONTACT_EMAIL, PDF_TAGLINE } from "@/lib/pdf/pdf-brand";
import type { FullPatientRecordExport } from "./get-full-patient-record";

registerPdfFonts();

export interface ExportConsentLine {
  data_type: string;
  purpose: string;
  action: string;
  created_at: string;
}

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, color: "#12324B", fontFamily: PDF_FONT_FAMILY },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  note: { fontSize: 9, color: "#555", marginBottom: 14 },
  heading: { fontSize: 12, fontWeight: 700, color: "#0E7C52", marginTop: 14, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: "#d6e6df", paddingBottom: 2 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 130, color: "#666" },
  value: { flex: 1 },
  line: { marginBottom: 2 },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 8, color: "#888", flexDirection: "row", justifyContent: "space-between" },
});

const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function vitalLine(v: FullPatientRecordExport["vitals"][number]): string {
  const when = date(v.taken_at);
  switch (v.vital_type) {
    case "blood_pressure":
      return `${when}  Blood pressure ${v.systolic}/${v.diastolic} mmHg`;
    case "glucose":
      return `${when}  Glucose ${v.glucose_mmol_l} mmol/L`;
    case "weight":
      return `${when}  Weight ${v.weight_kg} kg`;
    case "pulse":
      return `${when}  Heart rate ${v.pulse_bpm} bpm`;
    case "temperature":
      return `${when}  Temperature ${v.temperature_c} C`;
    case "spo2":
      return `${when}  Oxygen ${v.spo2_pct} %`;
    default:
      return `${when}  ${text(v.vital_type)}`;
  }
}

/**
 * A readable copy of a person's own record (v5 1.15). Same data as the JSON copy (getFullPatientRecordExport) plus their
 * consent history, rendered at download time from the live record under the patient's own session: no copy is stored.
 * Long lists are listed in full; this is a copy of what we hold, not a clinical summary.
 */
export function DataExportDocument({ record, consents }: { record: FullPatientRecordExport; consents: ExportConsentLine[] }) {
  const p = record.patient;
  return (
    <Document title="Your TarragonHealth record">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>Your TarragonHealth record</Text>
        <Text style={styles.note}>
          Prepared {date(record.exportedAt)}. This is a copy of the information we hold about you. Questions: {PDF_CONTACT_EMAIL}
        </Text>

        <Text style={styles.heading}>About you</Text>
        {[
          ["Name", p.fullName],
          ["Patient number", p.patientNumber],
          ["Date of birth", p.dateOfBirth],
          ["Phone", p.phone],
          ["Place", [p.area, p.city, p.state].filter(Boolean).join(", ")],
          ["Emergency contact", [p.emergencyContact.name, p.emergencyContact.relationship, p.emergencyContact.phone].filter(Boolean).join(", ")],
        ].map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{text(value)}</Text>
          </View>
        ))}

        <Text style={styles.heading}>Conditions</Text>
        {record.conditions.length === 0 && <Text style={styles.line}>None on file.</Text>}
        {record.conditions.map((c) => (
          <Text key={c.id} style={styles.line}>
            {text((c as { condition_name?: string | null }).condition_name ?? (c as { name?: string | null }).name)} {date(c.created_at)}
          </Text>
        ))}

        <Text style={styles.heading}>Allergies</Text>
        {record.allergies.length === 0 && <Text style={styles.line}>None on file.</Text>}
        {record.allergies.map((a) => (
          <Text key={a.id} style={styles.line}>
            {text((a as { allergen?: string | null }).allergen ?? (a as { name?: string | null }).name)} {date(a.created_at)}
          </Text>
        ))}

        <Text style={styles.heading}>Medicines</Text>
        {record.medications.length === 0 && <Text style={styles.line}>None on file.</Text>}
        {record.medications.map((m) => (
          <Text key={m.id} style={styles.line}>
            {text((m as { name?: string | null }).name)} {text((m as { dosage?: string | null }).dosage)} {date(m.created_at)}
          </Text>
        ))}

        <Text style={styles.heading}>Readings you logged ({record.vitals.length})</Text>
        {record.vitals.map((v) => (
          <Text key={v.id} style={styles.line}>
            {vitalLine(v)}
          </Text>
        ))}

        <Text style={styles.heading}>Screening results</Text>
        {record.screeningResults.length === 0 && <Text style={styles.line}>None on file.</Text>}
        {record.screeningResults.map((s, i) => (
          <Text key={i} style={styles.line}>
            {date(s.createdAt)}  {text(s.screenTypeName)}  {text(s.resultStatus)}  {text(s.resultSummary)}
          </Text>
        ))}

        <Text style={styles.heading}>Your consent choices</Text>
        {consents.length === 0 && <Text style={styles.line}>No changes recorded.</Text>}
        {consents.map((c, i) => (
          <Text key={i} style={styles.line}>
            {date(c.created_at)}  {c.action === "granted" ? "Turned on" : "Turned off"}  {c.data_type.replace(/_/g, " ")}, {c.purpose.replace(/_/g, " ")}
          </Text>
        ))}

        <View style={styles.footer} fixed>
          <Text>{PDF_TAGLINE}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
