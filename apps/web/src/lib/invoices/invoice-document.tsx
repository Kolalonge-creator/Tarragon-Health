import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
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

export interface InvoiceDocumentData {
  invoice_number: string;
  service_type: string;
  service_label: string;
  reference: string;
  total_minor: number;
  subtotal_minor: number;
  vat_minor: number;
  vat_treatment: "exempt" | "zero_rated" | "standard";
  vat_rate_pct: number | null;
  currency: Currency;
  issued_at: string;
}

export interface InvoiceLetterhead {
  legal_name: string | null;
  trading_name: string | null;
  rc_number: string | null;
  tin: string | null;
  vat_registration_number: string | null;
  registered_address: string | null;
  registered_email: string | null;
  registered_phone: string | null;
}

export interface InvoiceBillTo {
  name: string;
  patientNumber: string | null;
  phone: string | null;
}

/**
 * A4 letterhead geometry, identical to every other TarragonHealth-issued PDF
 * (preventive-care-plan-document.tsx, lab-request-document.tsx,
 * referral-letter-document.tsx) — one visual system across the platform.
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

  title: { fontSize: 18, fontWeight: 700, marginBottom: 3, color: PDF_CLINICAL_NAVY },
  subtitle: { fontSize: 9.5, color: "#5b6b78", marginBottom: 18 },

  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
    color: PDF_BRAND_GREEN,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaGrid: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  metaCol: { width: 240 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dfe3e6",
  },
  rowLabel: { color: "#5b6b78", marginRight: 8 },

  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_CLINICAL_NAVY,
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableHeaderText: { fontSize: 8, fontWeight: 700, color: "#5b6b78", textTransform: "uppercase" },
  itemCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dfe3e6",
  },
  colDesc: { flex: 3, fontSize: 10.5, fontWeight: 700, color: PDF_CLINICAL_NAVY },
  colAmount: { flex: 1, textAlign: "right" },

  totalsBlock: { marginTop: 12, alignSelf: "flex-end", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: "#5b6b78" },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontWeight: 700,
    fontSize: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_CLINICAL_NAVY,
    paddingTop: 6,
    marginTop: 4,
    color: PDF_CLINICAL_NAVY,
  },

  callout: {
    marginTop: 20,
    padding: 10,
    backgroundColor: "#EEF6F1",
    borderLeftWidth: 3,
    borderLeftColor: PDF_BRAND_GREEN,
  },
  calloutText: { fontSize: 9, color: "#5b6b78", lineHeight: 1.35 },

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

function formatMoney(minor: number, currency: Currency): string {
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(minor, currency).toLocaleString()}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function vatLine(invoice: InvoiceDocumentData): string {
  if (invoice.vat_treatment === "standard" && invoice.vat_rate_pct != null) {
    return `VAT (${invoice.vat_rate_pct}%)`;
  }
  return invoice.vat_treatment === "zero_rated" ? "VAT (zero-rated)" : "VAT (exempt)";
}

export function InvoiceDocument({
  invoice,
  billTo,
  letterhead,
}: {
  invoice: InvoiceDocumentData;
  billTo: InvoiceBillTo;
  letterhead: InvoiceLetterhead;
}) {
  const companyName = letterhead.trading_name || letterhead.legal_name || "TarragonHealth";

  return (
    <Document title={`TarragonHealth invoice ${invoice.invoice_number}`} author="TarragonHealth" subject="Invoice">
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
            <Text style={styles.headerDocLabel}>Invoice</Text>
            <Text style={styles.headerRef}>{invoice.invoice_number}</Text>
          </View>
        </View>
        <View style={styles.headerBandAccent} fixed />

        <Text style={styles.title}>Invoice</Text>
        <Text style={styles.subtitle}>Issued {formatDate(invoice.issued_at)}</Text>

        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text style={styles.sectionTitle}>Billed to</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text>{billTo.name}</Text>
            </View>
            {billTo.patientNumber && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Patient no.</Text>
                <Text>{billTo.patientNumber}</Text>
              </View>
            )}
            {billTo.phone && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Phone</Text>
                <Text>{billTo.phone}</Text>
              </View>
            )}
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.sectionTitle}>Invoice details</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Invoice no.</Text>
              <Text>{invoice.invoice_number}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Payment ref</Text>
              <Text>{invoice.reference}</Text>
            </View>
            {letterhead.rc_number && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>RC</Text>
                <Text>{letterhead.rc_number}</Text>
              </View>
            )}
            {letterhead.tin && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>TIN</Text>
                <Text>{letterhead.tin}</Text>
              </View>
            )}
            {letterhead.vat_registration_number && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>VAT reg.</Text>
                <Text>{letterhead.vat_registration_number}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colDesc, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colAmount, styles.tableHeaderText]}>Amount</Text>
          </View>
          <View style={styles.itemCard}>
            <Text style={styles.colDesc}>{invoice.service_label}</Text>
            <Text style={styles.colAmount}>{formatMoney(invoice.subtotal_minor, invoice.currency)}</Text>
          </View>

          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text>{formatMoney(invoice.subtotal_minor, invoice.currency)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{vatLine(invoice)}</Text>
              <Text>{invoice.vat_minor > 0 ? formatMoney(invoice.vat_minor, invoice.currency) : "—"}</Text>
            </View>
            <View style={styles.grandTotal}>
              <Text>Total paid</Text>
              <Text>{formatMoney(invoice.total_minor, invoice.currency)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutText}>
            This invoice confirms a payment already made — it is not a request for payment.
            {invoice.vat_treatment !== "standard"
              ? invoice.currency === "NGN"
                ? " Most medical and health services are exempt from VAT under the Nigerian VAT Act."
                : " VAT is not applied to this charge."
              : ""}
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLine}>
              {companyName} · {invoice.reference}
            </Text>
            <Text style={styles.footerLine}>
              <Text style={styles.footerBrand}>TarragonHealth</Text> · {letterhead.registered_email || PDF_CONTACT_EMAIL} ·{" "}
              {letterhead.registered_phone || PDF_CONTACT_PHONE}
            </Text>
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
