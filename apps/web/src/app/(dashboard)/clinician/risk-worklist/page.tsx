import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseWorklist, reasonLabel, type WorklistRow } from "@/lib/risk/worklist";
import { overrideRiskAction } from "./actions";

export const metadata = { title: "Risk worklist" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const OVERRIDE_MESSAGE: Record<string, string> = {
  done: "Saved. The new tier shows below until it expires. The computed score is unchanged.",
  invalid: "Not saved. Choose a tier, give a reason of at least 10 characters and a number of days from 1 to 30.",
  refused: "Not saved. You can only change the order for a patient you are tied to.",
};

function Row({ r }: { r: WorklistRow }) {
  return (
    <li className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{r.patient_number ?? "Patient"}</span>
        <span>
          <strong className="capitalize">{r.level}</strong>
          {r.overridden ? ` (set by a clinician; computed ${r.computed_level})` : ""}
        </span>
      </div>
      <p className="text-sm">
        Getting worse: {r.deterioration_risk} of 100. Slipping away: {r.dropout_risk} of 100. Scored {r.computed_on}.
      </p>
      <ul className="list-disc pl-5 text-sm">
        {r.reasons.length === 0 ? <li>Nothing flagged.</li> : r.reasons.map((x) => <li key={`${x.family}-${x.key}`}>{reasonLabel(x.key)}</li>)}
      </ul>
      <details>
        <summary className="min-h-11 cursor-pointer text-sm">Change where this patient sits</summary>
        <form action={overrideRiskAction} className="mt-2 grid gap-2 sm:max-w-md">
          <input type="hidden" name="patientId" value={r.patient_id} />
          <label className="space-y-1">
            <span className="block text-sm">Tier</span>
            <select name="level" defaultValue={r.level} className="min-h-11 w-full rounded border px-2">
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm">Reason (kept on record)</span>
            <textarea name="reason" required minLength={10} maxLength={500} rows={2} className="w-full rounded border px-2 py-1" />
          </label>
          <label className="space-y-1">
            <span className="block text-sm">For how many days (1 to 30)</span>
            <input type="number" name="days" min={1} max={30} defaultValue={7} className="min-h-11 w-24 rounded border px-2" />
          </label>
          <button type="submit" className="min-h-11 rounded border px-4">Save</button>
        </form>
      </details>
    </li>
  );
}

export default async function RiskWorklistPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  // The database also refuses anyone who is not a clinician, and returns only patients this clinician is tied to (INV-12).
  if (profile?.role !== "clinician") redirect("/clinician");
  const sp = await searchParams;
  const flash = typeof sp.override === "string" ? OVERRIDE_MESSAGE[sp.override] : undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clinician_risk_worklist", { p_limit: 25 });
  const list = error ? null : parseWorklist(data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk worklist"
        backTo={{ href: "/clinician", label: "Dashboard" }}
        description="Your patients, ordered by who may need a call first. This only orders your outreach. It is not a diagnosis, it is never a reason to hold back care, and a low tier never means no contact."
      />
      {flash ? <p role="status">{flash}</p> : null}
      {!list ? (
        <p role="alert">The worklist could not be read. Please refresh.</p>
      ) : list.rows.length === 0 ? (
        <p>None of your patients have been scored yet. Scores are worked out once a day for people who have joined.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{list.rows.length} patients</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {list.rows.map((r) => (
                <Row key={r.patient_id} r={r} />
              ))}
            </ul>
            <p className="mt-3 text-sm">Each time this list is opened, the patients shown are written to the audit log.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
