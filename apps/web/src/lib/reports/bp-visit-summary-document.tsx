import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { PDF_CONTACT_EMAIL, PDF_LOGO_SRC } from "@/lib/pdf/pdf-brand";
import { passportPdfStyles as styles } from "@/lib/health-passport/health-passport-document";
import type { BpVisitSummary } from "./bp-visit-summary";

/** "Bring this to your visit": the patient-held 7-day summary, in the Health Passport's letterhead and section styles. */
export function BpVisitSummaryDocument({ summary }: { summary: BpVisitSummary }) {
  return (
    <Document title={summary.title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.letterhead}>
          <View style={styles.brandRow}>
            {/* react-pdf's Image is not an HTML <img>: no alt prop exists */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={PDF_LOGO_SRC} />
            <View>
              <Text style={styles.brand}>TarragonHealth</Text>
              <Text style={styles.tagline}>Care that stays with you.</Text>
            </View>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Contact</Text>
            <Text style={[styles.metaValue, { marginBottom: 0 }]}>{PDF_CONTACT_EMAIL}</Text>
          </View>
        </View>

        <Text style={styles.title}>{summary.title}</Text>
        <Text style={styles.subtitle}>{summary.subtitle}</Text>
        <View style={{ marginBottom: 14 }}>
          <Text style={styles.muted}>{summary.intro}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{summary.bpHeading}</Text>
          {summary.bpLines.map((line, i) => (
            <View key={i} style={styles.row}>
              <Text>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{summary.medHeading}</Text>
          <View style={styles.row}>
            <Text>{summary.medLine}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{summary.symHeading}</Text>
          {summary.symLines.map((line, i) => (
            <View key={i} style={styles.row}>
              <Text>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{summary.footer}</Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
