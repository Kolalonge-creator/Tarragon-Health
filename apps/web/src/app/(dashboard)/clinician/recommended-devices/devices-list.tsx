import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deactivateBpDevice } from "./actions";
import { AddDeviceForm, ReviewDeviceForm } from "./device-forms";

/** The blood pressure monitors on the recommended list, shared by the admin editor (add, remove) and the CMO page (review). Born empty. */
export async function BpDevicesList({ mode }: { mode: "admin" | "cmo" }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("device_catalog")
    .select("id, device_name, vendor_name, description, validated_source_url, validation_basis, nafdac_number, authorised_distributor, active, clinically_reviewed, reviewed_at, review_note")
    .eq("category", "blood_pressure")
    .order("created_at", { ascending: false });
  if (error || !data) return <p role="alert" className="text-sm text-red-700">The monitors could not be loaded. Please refresh.</p>;
  const rows = mode === "cmo" ? data.filter((d) => d.active) : data;
  return (
    <div className="space-y-6">
      {mode === "admin" ? <AddDeviceForm /> : null}
      {rows.length === 0 ? <p className="text-sm">No blood pressure monitors are listed. Patients are told to look up their own model at stridebp.org.</p> : null}
      <ul className="space-y-4">
        {rows.map((d) => (
          <li key={d.id} className="space-y-2 rounded-lg border p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.device_name}</span>
              {d.vendor_name ? <span className="text-charcoal-ink/70">{d.vendor_name}</span> : null}
              <Badge variant={d.clinically_reviewed ? "green" : "amber"}>{d.clinically_reviewed ? "Reviewed by the CMO" : "Waiting for review"}</Badge>
              {!d.active ? <Badge variant="grey">Not listed</Badge> : null}
            </div>
            {d.description ? <p>{d.description}</p> : null}
            <p>
              Validation:{" "}
              {d.validated_source_url && /^https?:\/\//i.test(d.validated_source_url) ? (
                <a href={d.validated_source_url} target="_blank" rel="noopener noreferrer" className="underline">
                  {d.validation_basis === "validatebp" ? "registry entry" : "published study"}
                </a>
              ) : (
                "none given"
              )}
              . NAFDAC: {d.nafdac_number ?? "not given"}. Distributor: {d.authorised_distributor ?? "not given"}.
            </p>
            {d.review_note ? <p className="text-charcoal-ink/70">Review note: {d.review_note}</p> : null}
            {mode === "cmo" ? <ReviewDeviceForm id={d.id} reviewed={d.clinically_reviewed} /> : null}
            {mode === "admin" && d.active ? (
              <form action={deactivateBpDevice}>
                <input type="hidden" name="id" value={d.id} />
                <Button type="submit" variant="outline" className="min-h-11">Take off the list</Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
