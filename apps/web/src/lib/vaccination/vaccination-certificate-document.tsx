import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { VaccinationCertificateData } from "./get-certificate-data";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, color: "#12324B" },
  brand: { fontSize: 12, fontWeight: 700, color: "#0E7C52", marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#555", marginBottom: 28 },
  card: {
    borderWidth: 1,
    borderColor: "#0E7C52",
    borderRadius: 6,
    padding: 20,
    marginBottom: 24,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  label: { color: "#5b6b78" },
  value: { fontWeight: 700 },
  attribution: { marginTop: 8, fontSize: 10, color: "#12324B" },
  footer: { marginTop: 32, fontSize: 8, color: "#666" },
});

/**
 * The Tarragon-issued vaccination certificate. Only ever rendered for a dose a
 * Tarragon doctor has verified (see getVaccinationCertificateData, which
 * returns null otherwise), so the "verified by" line here is always backed by
 * a real verified_by/verified_at record — never invented.
 */
export function VaccinationCertificateDocument({
  data,
}: {
  data: VaccinationCertificateData;
}) {
  const attribution = data.verifier
    ? `Verified by Dr. ${data.verifier.fullName}${
        data.verifier.credentialType && data.verifier.credentialNumber
          ? ` (${data.verifier.credentialType} ${data.verifier.credentialNumber})`
          : ""
      } on ${new Date(data.verifiedAt).toLocaleDateString()}.`
    : `Verified by the Tarragon care team on ${new Date(data.verifiedAt).toLocaleDateString()}.`;

  return (
    <Document title={`Vaccination Certificate - ${data.patientName}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>TarragonHealth</Text>
        <Text style={styles.title}>Vaccination Certificate</Text>
        <Text style={styles.subtitle}>
          {data.patientName} · Certificate {data.serial}
        </Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Vaccine</Text>
            <Text style={styles.value}>{data.vaccineName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Dose</Text>
            <Text style={styles.value}>{data.doseNumber}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Date administered</Text>
            <Text style={styles.value}>
              {new Date(data.dateAdministered).toLocaleDateString()}
            </Text>
          </View>
          {data.provider && (
            <View style={styles.row}>
              <Text style={styles.label}>Administered at</Text>
              <Text style={styles.value}>{data.provider}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Certificate number</Text>
            <Text style={styles.value}>{data.serial}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Issued</Text>
            <Text style={styles.value}>{new Date(data.issuedAt).toLocaleDateString()}</Text>
          </View>
        </View>

        <Text style={styles.attribution}>{attribution}</Text>

        <Text style={styles.footer}>
          This certificate was issued by TarragonHealth after a member of the care team reviewed the
          physical vaccination record uploaded by the patient. Certificate {data.serial}. Care that
          stays with you.
        </Text>
      </Page>
    </Document>
  );
}
