import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

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

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: "#12324B" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  brand: { fontSize: 18, fontWeight: 700, color: "#0E7C52" },
  tagline: { fontSize: 8, color: "#666", marginTop: 2 },
  companyBlock: { fontSize: 8, color: "#666", textAlign: "right", maxWidth: 220 },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 12 },
  metaGrid: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  metaCol: { maxWidth: 240 },
  sectionTitle: { fontSize: 8, fontWeight: 700, color: "#666", marginBottom: 4, textTransform: "uppercase" },
  metaLine: { fontSize: 10, marginBottom: 2 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#12324B",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableHeaderText: { fontSize: 8, fontWeight: 700, color: "#666", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 8 },
  colDesc: { flex: 3 },
  colAmount: { flex: 1, textAlign: "right" },
  totalsBlock: { marginTop: 12, alignSelf: "flex-end", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: "#555" },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontWeight: 700,
    fontSize: 12,
    borderTopWidth: 1,
    borderTopColor: "#12324B",
    paddingTop: 6,
    marginTop: 4,
  },
  footer: { marginTop: 40, fontSize: 8, color: "#666", borderTopWidth: 0.5, borderTopColor: "#ddd", paddingTop: 10 },
  footerLine: { marginBottom: 3 },
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
    <Document title={`Invoice ${invoice.invoice_number}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>TarragonHealth</Text>
            <Text style={styles.tagline}>Care that stays with you.</Text>
          </View>
          <View style={styles.companyBlock}>
            {letterhead.legal_name && <Text>{letterhead.legal_name}</Text>}
            {letterhead.registered_address && <Text>{letterhead.registered_address}</Text>}
            {letterhead.rc_number && <Text>RC {letterhead.rc_number}</Text>}
            {letterhead.tin && <Text>TIN {letterhead.tin}</Text>}
            {letterhead.vat_registration_number && <Text>VAT Reg {letterhead.vat_registration_number}</Text>}
            {letterhead.registered_email && <Text>{letterhead.registered_email}</Text>}
            {letterhead.registered_phone && <Text>{letterhead.registered_phone}</Text>}
          </View>
        </View>

        <Text style={styles.title}>Invoice</Text>

        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text style={styles.sectionTitle}>Billed to</Text>
            <Text style={styles.metaLine}>{billTo.name}</Text>
            {billTo.patientNumber && <Text style={styles.metaLine}>Patient no. {billTo.patientNumber}</Text>}
            {billTo.phone && <Text style={styles.metaLine}>{billTo.phone}</Text>}
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.sectionTitle}>Invoice details</Text>
            <Text style={styles.metaLine}>Invoice no. {invoice.invoice_number}</Text>
            <Text style={styles.metaLine}>Date issued {formatDate(invoice.issued_at)}</Text>
            <Text style={styles.metaLine}>Payment ref {invoice.reference}</Text>
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={[styles.colDesc, styles.tableHeaderText]}>Description</Text>
          <Text style={[styles.colAmount, styles.tableHeaderText]}>Amount</Text>
        </View>
        <View style={styles.tableRow}>
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

        <View style={styles.footer}>
          <Text style={styles.footerLine}>
            This invoice confirms a payment already made — it is not a request for payment.
          </Text>
          {invoice.vat_treatment !== "standard" && (
            <Text style={styles.footerLine}>
              {invoice.currency === "NGN"
                ? "Most medical and health services are exempt from VAT under the Nigerian VAT Act."
                : "VAT is not applied to this charge."}
            </Text>
          )}
          <Text style={styles.footerLine}>{companyName} — {invoice.reference}</Text>
        </View>
      </Page>
    </Document>
  );
}
