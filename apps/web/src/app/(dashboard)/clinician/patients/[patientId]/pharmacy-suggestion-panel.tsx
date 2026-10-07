import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPatientDateTime } from "@/lib/format-date";
import { loadOptions, loadRoutingRows, type Loaded } from "@/lib/pharmacy-suggestion/load";
import { withdrawSuggestionAction } from "@/lib/pharmacy-suggestion/actions";
import { proximityLabel, statusLabel, stockLabel, type PharmacyOption, type RoutingRow } from "@/lib/pharmacy-suggestion/model";
import { SuggestPharmacyForm } from "./suggest-pharmacy-form";

/**
 * S54c (OQ-310 option b): suggest a pharmacy for a signed prescription. The PATIENT confirms; nothing is sent until the patient does, and the patient can take
 * the prescription to any pharmacy. Only neutral facts are shown (name, place, how near, in stock or not, verified): never a price, a ranking by
 * earnings or anything about what a pharmacy pays Tarragon (spec 8.16). Reads are audited; a refusal reads as "not available", never "none".
 */
const MAX_PRESCRIPTIONS = 5;

function Options({ patientId, prescriptionId, options }: { patientId: string; prescriptionId: string; options: PharmacyOption[] }) {
  if (options.length === 0) return <p className="text-sm text-charcoal-ink/60">No verified partner pharmacy near this patient yet. The patient can take the signed prescription to any pharmacy.</p>;
  return (
    <ul className="space-y-2">
      {options.map((o) => (
        <li key={o.location_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 p-2 text-sm">
          <div>
            <p className="font-medium">{o.partner_name}</p>
            <p className="text-xs text-charcoal-ink/70">{[o.location_name, o.address, o.state].filter(Boolean).join(", ")}</p>
            <p className="text-xs text-charcoal-ink/70">
              {proximityLabel[o.proximity]}. {stockLabel[o.in_stock]}. Verified partner.
            </p>
          </div>
          <SuggestPharmacyForm patientId={patientId} prescriptionId={prescriptionId} partnerId={o.partner_id} locationId={o.location_id} label="Suggest this pharmacy" />
        </li>
      ))}
    </ul>
  );
}

function Row({ patientId, row, options }: { patientId: string; row: RoutingRow; options: Loaded<PharmacyOption[]> | null }) {
  const waiting = row.rx_state === "signed";
  const mine = row.suggested_by_me === true;
  return (
    <li className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="font-medium">{row.item_summary || "Prescription"}</p>
      <p className="text-xs text-charcoal-ink/60">{waiting ? "Signed, waiting for the patient to choose where to collect" : "Sent to a pharmacy by the patient"}</p>
      {row.suggestion_id && row.suggestion_status ? (
        <div className="space-y-1 text-sm">
          <p>
            {mine ? "Your suggestion" : "A colleague's suggestion"}: {row.suggested_partner_name}
            {row.suggested_location_name ? `, ${row.suggested_location_name}` : ""}. {statusLabel[row.suggestion_status] ?? row.suggestion_status}
            {row.suggested_at ? ` (${formatPatientDateTime(row.suggested_at)})` : ""}.
          </p>
          {mine && (row.suggestion_status === "pending" || row.suggestion_status === "unavailable") ? (
            <form action={withdrawSuggestionAction}>
              <input type="hidden" name="patientId" value={patientId} />
              <input type="hidden" name="suggestionId" value={row.suggestion_id} />
              <Button type="submit" size="sm" variant="outline">Withdraw suggestion</Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {waiting && options ? (
        options.ok ? (
          <Options patientId={patientId} prescriptionId={row.prescription_id} options={options.data} />
        ) : (
          <p role="alert" className="text-sm text-charcoal-ink/60">Pharmacy options are not available to you right now. This is not an empty list.</p>
        )
      ) : null}
    </li>
  );
}

export async function PharmacySuggestionPanel({ patientId }: { patientId: string }) {
  const rows = await loadRoutingRows(patientId);
  const shown = rows.ok ? rows.data.slice(0, MAX_PRESCRIPTIONS) : [];
  // Options are read (and audited) only for a prescription with no live suggestion: withdraw first to pick another. This keeps a plain
  // page view from writing one audit row per prescription for options nobody asked to see.
  const wantsOptions = (r: RoutingRow) => r.rx_state === "signed" && r.suggestion_status !== "pending";
  const optionSets = await Promise.all(shown.map((r) => (wantsOptions(r) ? loadOptions(patientId, r.prescription_id) : Promise.resolve(null))));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggest a pharmacy</CardTitle>
        <CardDescription>
          The patient chooses and confirms. Nothing is sent to a pharmacy until the patient does, and the patient can take the signed prescription anywhere. Pharmacies are listed by how near they are, then by name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!rows.ok ? (
          <p role="alert" className="text-sm text-charcoal-ink/60">Not available to you right now. This is not an empty list.</p>
        ) : rows.data.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No signed prescription is waiting for a pharmacy.</p>
        ) : (
          <ul className="space-y-3">
            {shown.map((r, i) => (
              <Row key={r.prescription_id} patientId={patientId} row={r} options={optionSets[i]} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
