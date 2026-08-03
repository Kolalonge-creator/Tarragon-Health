import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

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
  requestedByMdcn: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: "#12324B" },
  brand: { fontSize: 12, fontWeight: 700, color: "#0E7C52", marginBottom: 2 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 16 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#0E7C52" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  testRow: { paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  muted: { color: "#666" },
  callout: {
    marginTop: 4,
    padding: 8,
    backgroundColor: "#F1F7F3",
    borderLeftWidth: 2,
    borderLeftColor: "#0E7C52",
  },
  footer: { marginTop: 20, fontSize: 8, color: "#666" },
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
 * The take-anywhere test request: the physical artifact that replaces routing a
 * sample to a partner lab. It says WHAT to run and WHO for, and nothing about
 * price or where to go, because the patient chooses the lab and pays them
 * directly.
 *
 * Deliberately does not name a lab, quote a price, or imply any commercial
 * relationship — Tarragon takes nothing on the test and must not appear to be
 * directing the patient anywhere it benefits from.
 */
export function LabRequestDocument({ data }: { data: LabRequestData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>TarragonHealth</Text>
        <Text style={styles.title}>Laboratory test request</Text>
        <Text style={styles.subtitle}>
          {data.orderNumber ? `Request ${data.orderNumber} · ` : ""}
          Issued {formatDate(data.orderedAt)}
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
          {data.sex && (
            <View style={styles.row}>
              <Text>Sex</Text>
              <Text>{data.sex}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tests requested: {data.panelName}</Text>
          {data.panelDescription && (
            <Text style={[styles.muted, { marginBottom: 4 }]}>{data.panelDescription}</Text>
          )}
          {data.testNames.length > 0 ? (
            data.testNames.map((name) => (
              <View key={name} style={styles.testRow}>
                <Text>{name}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>
              See the panel name above; ask the laboratory for the standard profile.
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Requested by</Text>
          {data.requestedByName ? (
            <Text>
              {data.requestedByName}
              {data.requestedByMdcn ? ` (MDCN ${data.requestedByMdcn})` : ""}, TarragonHealth care
              team
            </Text>
          ) : (
            <Text style={styles.muted}>
              Preventive screening requested by the patient through TarragonHealth, in line with
              their screening schedule.
            </Text>
          )}
        </View>

        <View style={styles.callout}>
          <Text style={{ fontWeight: 700, marginBottom: 3 }}>For the patient</Text>
          <Text>
            Take this to any registered laboratory you choose. You pay the laboratory directly;
            TarragonHealth does not take a fee or commission on this test. When you get the result,
            upload it in the app and a doctor will read it with you, including if everything is
            normal.
          </Text>
        </View>

        <Text style={styles.footer}>
          This request lists the tests recommended for this person on the date shown. It is not a
          prescription, a diagnosis, or a guarantee of any laboratory&apos;s price or availability.
          Questions about the tests should go to the TarragonHealth care team in the app.
        </Text>
      </Page>
    </Document>
  );
}
