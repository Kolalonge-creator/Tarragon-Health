import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { PDF_CONTACT_EMAIL, PDF_LOGO_SRC } from "@/lib/pdf/pdf-brand";
import { passportPdfStyles as styles } from "@/lib/health-passport/health-passport-document";
import { KIND_LABEL } from "@/lib/earnings/earnings";
import { PAY_STATUS_LABEL, type PayoutStatement } from "@/lib/earnings/disputes";
import { pdfNaira } from "@/lib/earnings/pdf-money";

const day = (value: string): string => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

/**
 * A contracted clinician's statement for one payout: gross, the withholding amount as it was entered (never calculated here or anywhere,
 * D-09), net, and every line with its status. It names a task type and a date, never a patient (INV-07). It is a statement, not a tax
 * credit note: that follows once the withholding rules are decided (OQ-193).
 */
export function PayoutStatementDocument({ statement }: { statement: PayoutStatement }) {
  return (
    <Document title={`Payout statement up to ${day(statement.period_end)}`}>
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

        <Text style={styles.title}>Payout statement</Text>
        <Text style={styles.subtitle}>
          {statement.clinician_name ?? "Clinician"}, work up to {day(statement.period_end)}
          {statement.tin ? `, tax identification number ${statement.tin}` : ""}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Totals</Text>
          <View style={styles.row}><Text>Gross earnings</Text><Text>{pdfNaira(statement.gross_kobo)}</Text></View>
          <View style={styles.row}>
            <Text>Withholding (entered by finance, not calculated)</Text>
            <Text>{pdfNaira(-statement.withholding_kobo)}</Text>
          </View>
          {statement.withholding_note ? <View style={styles.row}><Text style={styles.muted}>{statement.withholding_note}</Text></View> : null}
          <View style={styles.row}><Text>Net</Text><Text>{pdfNaira(statement.net_kobo)}</Text></View>
          {statement.reference ? <View style={styles.row}><Text style={styles.muted}>Reference {statement.reference}</Text></View> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lines</Text>
          {statement.lines.map((l) => (
            <View key={l.id} style={styles.row} wrap={false}>
              <Text>
                {day(l.earned_at)}: {KIND_LABEL[l.kind] ?? l.kind}
                {l.task_type ? ` (${l.task_type.replaceAll("_", " ")})` : ""} - {PAY_STATUS_LABEL[l.pay_status]}
              </Text>
              <Text>{pdfNaira(l.amount_kobo)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            This statement lists what you earned for the lines above. It is not a tax document. If a line looks wrong, question it from Earnings in your console.
          </Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
