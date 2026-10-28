import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { PDF_BRAND_GREEN, PDF_CONTACT_EMAIL, PDF_TAGLINE } from "@/lib/pdf/pdf-brand";
import { figureRows, nairaFromKobo, type ProcurementPack } from "./files";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: "#1f2933" },
  brand: { fontSize: 16, color: PDF_BRAND_GREEN, fontWeight: 700 },
  tag: { fontSize: 9, marginBottom: 12 },
  h1: { fontSize: 15, marginBottom: 4 },
  h2: { fontSize: 12, marginTop: 12, marginBottom: 4, color: PDF_BRAND_GREEN },
  row: { flexDirection: "row", marginBottom: 2 },
  k: { width: "45%" },
  v: { width: "55%" },
  small: { fontSize: 8.5, marginTop: 6, lineHeight: 1.4 },
});

/** The procurement and renewal pack as a PDF. Built only from the pack the database returned: frozen, suppressed figures, never a person. */
export function PackDocument({ pack }: { pack: ProcurementPack }) {
  const day = (v: string) => v.slice(0, 10);
  return (
    <Document title={`Programme pack for ${pack.sponsor}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>TarragonHealth</Text>
        <Text style={s.tag}>{PDF_TAGLINE}</Text>
        <Text style={s.h1}>Programme pack for {pack.sponsor}</Text>
        <Text>Prepared {day(pack.generated_at)}. Contact {PDF_CONTACT_EMAIL}. The smallest group shown anywhere is {pack.minimum_cell}.</Text>

        <Text style={s.h2}>Programmes and group figures</Text>
        {pack.programmes.length === 0 && <Text>No programme yet.</Text>}
        {pack.programmes.map((g) => (
          <View key={g.name} wrap={false} style={{ marginBottom: 6 }}>
            <Text>
              {g.name} ({g.status}), {g.valid_from} to {g.valid_to}. Latest month: {g.latest_period ?? "none"}
            </Text>
            {figureRows(g.figures).map(([k, v]) => (
              <View key={k} style={s.row}>
                <Text style={s.k}>{k.replace(/[._]/g, " ")}</Text>
                <Text style={s.v}>{v}</Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={s.h2}>Contract terms</Text>
        {pack.contracts.length === 0 && <Text>No contract on record.</Text>}
        {pack.contracts.map((c) => (
          <Text key={c.name + String(c.effective_from)}>
            {c.name} ({c.status}) {c.effective_from ?? ""} to {c.effective_to ?? ""}; {nairaFromKobo(c.per_employee_per_year_kobo)} per person per year; {c.employee_count} people.
          </Text>
        ))}

        <Text style={s.h2}>Usage by month</Text>
        {pack.usage.length === 0 && <Text>No usage statements yet.</Text>}
        {pack.usage.map((u) => (
          <View key={u.period} wrap={false} style={{ marginBottom: 4 }}>
            <Text>
              {u.period.slice(0, 7)}: {nairaFromKobo(u.total_kobo)}
            </Text>
            {(u.lines ?? []).map((l) => (
              <Text key={l.service_code}>
                {"   "}
                {l.service_code.replace(/_/g, " ")}: {l.units} uses, {nairaFromKobo(l.amount_kobo)}
              </Text>
            ))}
            {u.other_services_kobo ? <Text>{"   "}other services: {nairaFromKobo(u.other_services_kobo)}</Text> : null}
          </View>
        ))}

        {pack.configuration && (
          <>
            <Text style={s.h2}>Agreed configuration (version {pack.configuration.version})</Text>
            <Text>Pathways: {pack.configuration.pathways.join(", ") || "none"}. Sponsored services: {pack.configuration.item_codes.join(", ") || "none"}.</Text>
          </>
        )}

        <Text style={s.h2}>What was withheld, and why</Text>
        {pack.privacy_ledger.length === 0 && <Text>Nothing was withheld.</Text>}
        {pack.privacy_ledger.map((e, i) => (
          <Text key={`${e.period}${e.programme}${e.tile}${i}`}>
            {e.period.slice(0, 7)} {e.programme}: {e.tile.replace(/_/g, " ")} ({e.reason.replace(/_/g, " ")})
          </Text>
        ))}

        <Text style={s.h2}>How to read this pack</Text>
        <Text style={s.small}>{pack.methodology}</Text>
      </Page>
    </Document>
  );
}
