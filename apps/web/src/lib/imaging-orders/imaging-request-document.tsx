import { Document, Page, Text, View, Image } from "@react-pdf/renderer";
import { PDF_LOGO_SRC, PDF_CONTACT_EMAIL, PDF_CONTACT_PHONE, PDF_TAGLINE } from "@/lib/pdf/pdf-brand";
import { formatDate, styles } from "@/lib/lab-results/lab-request-document";

export interface ImagingRequestData {
  patientName: string;
  patientNumber: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  orderedAt: string;
  studyName: string;
  urgency: "routine" | "urgent" | "emergency";
  indication: string;
  clinicalInformation: string | null;
  contraindicationInformation: string | null;
  requestedByName: string | null;
  requestedByCredentialType: string | null;
  requestedByCredentialNumber: string | null;
}

/**
 * The take-anywhere imaging request (diagnostic directory Phase 5). Same rules as the laboratory request: it says WHAT is
 * requested and WHY, names no imaging centre and quotes no price (ImagingRequestData has no field for either), because the
 * patient chooses where to go. A doctor's suggested place, if any, is shown in the app with its explanation, never here.
 */
export function ImagingRequestDocument({ data }: { data: ImagingRequestData }) {
  return (
    <Document title="Tarragon Health: imaging request" author="TarragonHealth" subject="Imaging request">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerBand} fixed>
          <View style={styles.brandRow}>
            {/* react-pdf's Image is not an HTML <img>; no alt prop exists */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={PDF_LOGO_SRC} />
            <View style={styles.brandTextCol}>
              <Text style={styles.brandWordmark}>TarragonHealth</Text>
              <Text style={styles.brandTagline}>{PDF_TAGLINE}</Text>
            </View>
          </View>
          <View style={styles.headerRightCol}>
            <Text style={styles.headerDocLabel}>Imaging request</Text>
          </View>
        </View>
        <View style={styles.headerBandAccent} fixed />

        <Text style={styles.title}>Imaging request</Text>
        <Text style={styles.subtitle}>Issued {formatDate(data.orderedAt)}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Patient</Text>
          <View style={styles.row}><Text style={styles.rowLabel}>Name</Text><Text>{data.patientName}</Text></View>
          {data.patientNumber && <View style={styles.row}><Text style={styles.rowLabel}>Patient number</Text><Text>{data.patientNumber}</Text></View>}
          <View style={styles.row}><Text style={styles.rowLabel}>Date of birth</Text><Text>{formatDate(data.dateOfBirth)}</Text></View>
          {data.sex && <View style={styles.row}><Text style={styles.rowLabel}>Sex</Text><Text style={{ textTransform: "capitalize" }}>{data.sex}</Text></View>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Study requested</Text>
          <View style={styles.row}><Text style={styles.rowLabel}>Study</Text><Text>{data.studyName}</Text></View>
          <View style={styles.row}><Text style={styles.rowLabel}>Urgency</Text><Text style={{ textTransform: "capitalize" }}>{data.urgency}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reason for this request</Text>
          <View style={styles.reasonBox}><Text>{data.indication}</Text></View>
        </View>

        {(data.clinicalInformation || data.contraindicationInformation) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>For the reporting clinician</Text>
            {data.clinicalInformation && <Text style={{ marginBottom: 4 }}>{data.clinicalInformation}</Text>}
            {data.contraindicationInformation && <Text>Safety information: {data.contraindicationInformation}</Text>}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Requested by</Text>
          {data.requestedByName ? (
            <Text>
              {data.requestedByName}
              {data.requestedByCredentialType && data.requestedByCredentialNumber ? ` (${data.requestedByCredentialType} ${data.requestedByCredentialNumber})` : ""}
              , TarragonHealth care team
            </Text>
          ) : (
            <Text style={styles.muted}>A TarragonHealth doctor requested this study.</Text>
          )}
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>For the patient</Text>
          <Text>
            Take this to any registered imaging centre you choose, and pay the centre directly at its price. When you get the
            report, upload it in the app and a doctor will read it with you, including if everything is normal.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLine}>
              This request names the study recommended for this person on the date shown. It is not a diagnosis, or a guarantee of
              any centre&apos;s price or availability.
            </Text>
            <Text style={styles.footerLine}>
              <Text style={styles.footerBrand}>TarragonHealth</Text> · {PDF_CONTACT_EMAIL} · {PDF_CONTACT_PHONE}
            </Text>
          </View>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
