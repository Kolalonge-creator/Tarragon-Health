import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { PDF_CONTACT_EMAIL, PDF_LOGO_SRC } from "@/lib/pdf/pdf-brand";
import { passportPdfStyles as styles } from "@/lib/health-passport/health-passport-document";
import type { BpMonthlySummary } from "./bp-monthly-summary";

/** The patient-held monthly blood pressure and medicines summary, in the Health Passport's letterhead and section styles. */
export function BpMonthlySummaryDocument({ summary }: { summary: BpMonthlySummary }) {
  return (
    <Document title={summary.subtitle}>
      <Page size="A4" style={styles.page}>
        <View style={styles.letterhead}>
          <View style={styles.brandRow}>
            {/* react-pdf's Image is not an HTML <img> — no alt prop exists */}
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blood pressure at home</Text>
          {summary.bpLines.map((line, i) => (
            <View key={i} style={styles.row}>
              <Text>{line}</Text>
            </View>
          ))}
          {summary.weeks.map((line, i) => (
            <View key={`w${i}`} style={styles.row}>
              <Text style={styles.muted}>{line}</Text>
            </View>
          ))}
        </View>

        {summary.homeChecks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Seven-day home checks</Text>
            {summary.homeChecks.map((line, i) => (
              <View key={i} style={styles.row}>
                <Text>{line}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Medicines</Text>
          <View style={styles.row}>
            <Text>{summary.adherence}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{summary.footer}</Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
