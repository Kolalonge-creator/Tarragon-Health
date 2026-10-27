import Link from "next/link";
import { redirect } from "next/navigation";
import { describeReason, parseWorklist, WORKLIST_LIMITS, type WorklistPayload } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createMentalHealthFollowUpAction } from "./actions";

export const metadata = { title: "Mental health follow-ups" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FLASH: Record<string, string> = {
  done: "Follow-up created. It is in the task queue, and this patient stays on the list, marked, for a few days.",
  invalid: "Not created. Something in the form was not valid.",
  refused: "Not created. You can only follow up a patient who is on your own list, and the rules must be in force.",
};

const NOTE: Record<string, string> = {
  overdue_off_cadence_unsigned: "The check for overdue questionnaires is off because the screening schedule has not been signed.",
};

function Limits() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What this list does not detect</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {WORKLIST_LIMITS.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </CardContent>
    </Card>
  );
}

function Calm({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent><p className="text-sm">{body}</p></CardContent>
    </Card>
  );
}

function Rows({ list }: { list: WorklistPayload }) {
  if (list.rows.length === 0) {
    return <Calm title="Nobody on your list" body="No patient you are tied to meets a rule right now. That does not mean everyone is well: see what this list cannot see, below." />;
  }
  return (
    <Card>
      <CardHeader><CardTitle>{list.rows.length} {list.rows.length === 1 ? "patient" : "patients"}</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {list.rows.map((r) => (
            <li key={r.patientId} className="space-y-2 rounded border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.fullName ?? "Patient"} <span className="text-sm font-normal">{r.patientNumber ?? ""}</span></span>
                <Link className="min-h-11 text-sm underline" href={`/clinician/patients/${r.patientId}`}>Open the chart</Link>
              </div>
              <ul className="list-disc pl-5 text-sm">
                {r.reasons.map((x, i) => <li key={`${x.code}-${i}`}>{describeReason(x)}</li>)}
              </ul>
              {r.followedUpAt ? (
                <p className="text-sm">Follow-up created {new Date(r.followedUpAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" })}. The patient stays on the list so nothing is hidden.</p>
              ) : null}
              <details>
                <summary className="min-h-11 cursor-pointer text-sm">Make a follow-up task</summary>
                <form action={createMentalHealthFollowUpAction} className="mt-2 grid gap-2 sm:max-w-md">
                  <input type="hidden" name="patientId" value={r.patientId} />
                  <label className="space-y-1">
                    <span className="block text-sm">Note for the person who picks it up (optional, up to 300 characters)</span>
                    <textarea name="note" maxLength={300} rows={2} className="w-full rounded border px-2 py-1" />
                  </label>
                  <button type="submit" className="min-h-11 rounded border px-4">Create the task</button>
                </form>
              </details>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm">Each time this list is opened, the patients shown are written to the audit log.</p>
      </CardContent>
    </Card>
  );
}

export default async function MentalHealthWorklistPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  // The database also refuses care coordinators and anyone who is not a clinician, and returns only patients this clinician is tied to (INV-12).
  if (profile?.role !== "clinician") redirect("/clinician");
  const sp = await searchParams;
  const flash = typeof sp.followup === "string" ? FLASH[sp.followup] : undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_mental_health_worklist");
  const refused = error?.code === "42501";
  const list = error ? null : parseWorklist(data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mental health follow-ups"
        backTo={{ href: "/clinician", label: "Dashboard" }}
        description="Patients you are tied to who may need a follow-up, picked by fixed rules the Chief Medical Officer signed. It is a prompt to look, never a diagnosis and never a reason to hold back care."
      />
      {flash ? <p role="status">{flash}</p> : null}
      {refused ? (
        <Calm title="Not available to you" body="This list shows questionnaire scores, so it is for doctors. A care coordinator does not see scores. Ask a doctor on your team if a patient needs a follow-up." />
      ) : !list || list.status === "unreadable" ? (
        <p role="alert">The list could not be read. Please refresh.</p>
      ) : list.status === "off" ? (
        <Calm title="Not switched on yet" body="This list is not switched on. When it is, it will appear here. Nothing about a patient's care depends on it." />
      ) : list.status === "not_signed" ? (
        <Calm title="Waiting for the rules to be signed" body="The rules for this list have not been signed by the Chief Medical Officer yet, so it shows nothing. This is not an all-clear. Urgent answers already reach the on-call clinician by their own path." />
      ) : (
        <>
          {list.notes.map((n) => <p key={n} className="text-sm">{NOTE[n] ?? n}</p>)}
          <Rows list={list} />
        </>
      )}
      <Limits />
    </div>
  );
}
