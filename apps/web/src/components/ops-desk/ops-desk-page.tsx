import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Field, fieldClass, Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";
import { formatLagos } from "@/lib/rota/time";
import { acknowledgeIncident, attestItem, logCall, saveContact, setContactActive, setWindows } from "@/lib/ops-desk/actions";
import { getOpenPageIncidents, getOpsDeskCallSheet, getOpsDeskCalls, getOpsDeskOverview, getOpsDeskRoster, type PageIncident } from "@/lib/ops-desk/queries";
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, CALLEE_KIND_LABEL, WEEKDAY_LABEL, type CallSheet, type ChecklistItem, type RosterContact } from "@/lib/ops-desk/schemas";

type Mode = "admin" | "cmo";
const PATH: Record<Mode, "/admin/ops/desk" | "/clinician/ops-desk"> = { admin: "/admin/ops/desk", cmo: "/clinician/ops-desk" };

const CHECK_LABEL: Record<ChecklistItem["state"], string> = { in_place: "In place", not_in_place: "Not in place", not_attested: "Nobody has said yet" };

function windowsText(c: RosterContact): string {
  if (c.windows.length === 0) return "No hours set";
  return c.windows.map((w) => `${(WEEKDAY_LABEL[w.day] ?? "").slice(0, 3)} ${w.start}-${w.end}`).join(", ");
}

function windowsInput(c: RosterContact): string {
  return c.windows.map((w) => `${w.day} ${w.start}-${w.end}`).join("\n");
}

async function adminProfiles(): Promise<{ id: string; full_name: string | null }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name").eq("role", "admin").eq("is_active", true).order("full_name");
  return data ?? [];
}

function IncidentCard({ inc, sheet, me, path }: { inc: PageIncident; sheet: CallSheet | null; me: string | null; path: string }) {
  const mine = inc.owner_id !== null && inc.owner_id === me;
  return (
    <div className="space-y-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-500/40 dark:bg-red-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="red">Phone now</Badge>
        <span className="font-medium">{inc.reference}</span>
        <span>opened {formatLagos(inc.detected_at)}</span>
        <span className="text-charcoal-ink/60 dark:text-night-ink/60">{inc.owner_id === null ? "Nobody is assigned" : mine ? "Assigned to you" : "Assigned to someone else"}</span>
      </div>
      {mine ? (
        <form action={acknowledgeIncident}>
          <Hidden name="returnTo" value={path} />
          <Hidden name="incident" value={inc.id} />
          <SubmitButton>I have this one</SubmitButton>
        </form>
      ) : null}
      {sheet ? (
        <ul className="space-y-1">
          {sheet.people.map((p) => (
            <li key={`${p.kind}-${p.profile_id}`}>
              <span className="font-medium">{CALLEE_KIND_LABEL[p.kind]}:</span> {p.name},{" "}
              {p.phone ? <a className="underline" href={`tel:${p.phone}`}>{p.phone}</a> : <span className="text-red-700 dark:text-red-300">no confirmed number on file: ask the chief medical officer or phone from the paper list</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-red-700 dark:text-red-300">The call sheet could not be read. Use the paper list and record the calls when you can.</p>
      )}
      {sheet ? (
        <form action={logCall} className="grid gap-2 sm:grid-cols-4">
          <Hidden name="returnTo" value={path} />
          <Hidden name="incident" value={inc.id} />
          <Field label="Who you phoned">
            <select name="callee" className={fieldClass} required defaultValue="">
              <option value="" disabled>Choose</option>
              {sheet.people.map((p) => (
                <option key={`${p.kind}-${p.profile_id}`} value={`${p.kind}|${p.profile_id}`}>{`${CALLEE_KIND_LABEL[p.kind]}: ${p.name}`}</option>
              ))}
            </select>
          </Field>
          <Field label="What happened">
            <select name="outcome" className={fieldClass} required defaultValue="">
              <option value="" disabled>Choose</option>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>{CALL_OUTCOME_LABEL[o]}</option>
              ))}
            </select>
          </Field>
          <Field label="Note (no patient names or numbers)">
            <input name="note" maxLength={500} className={fieldClass} />
          </Field>
          <div className="flex items-end"><SubmitButton>Record the call</SubmitButton></div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * The ops desk (OQ-441). Administrators maintain the roster of named ops contacts and work a page that expired: who to phone, and a
 * record of each call. The chief medical officer reads the same facts and attests to the resilience checklist. Nothing here sends an sms or places a
 * call: a person phones. Page text and this screen never show a patient.
 */
export async function OpsDeskPage({ mode, searchParams }: { mode: Mode; searchParams: SearchParams }) {
  const sp = await searchParams;
  const path = PATH[mode];
  const profile = await getCurrentProfile();
  const [overview, roster, calls] = await Promise.all([getOpsDeskOverview(30), getOpsDeskRoster(), getOpsDeskCalls(null, 100)]);
  let incidents: PageIncident[] = [];
  let incidentsFailed = false;
  try {
    incidents = await getOpenPageIncidents();
  } catch {
    incidentsFailed = true;
  }
  const sheets = new Map<string, CallSheet | null>();
  if (mode === "admin") {
    await Promise.all(
      incidents.map(async (i) => {
        try {
          sheets.set(i.id, await getOpsDeskCallSheet(i.id));
        } catch {
          sheets.set(i.id, null);
        }
      }),
    );
  }
  const candidates = mode === "admin" ? await adminProfiles() : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Ops desk"
        description="When a priority page runs out of alerts and nobody answers, a named ops person phones the on-call clinician and the chief medical officer. This is where those people are named, where each call is recorded, and where the backup power, internet and phone checks are signed by a person."
      />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />

      <Section title="Where it stands" hint="Counts are for the last 30 days.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={overview.on_duty_now > 0 ? "green" : "red"}>{overview.on_duty_now > 0 ? `${overview.on_duty_now} on duty now` : "Nobody on duty now"}</Badge>
          <Badge variant={overview.active_primary > 0 ? "green" : "amber"}>{overview.active_primary} primary</Badge>
          <Badge variant={overview.active_deputy > 0 ? "green" : "amber"}>{overview.active_deputy} deputy</Badge>
          <Badge variant={overview.ready ? "green" : "grey"}>{overview.ready ? "Checklist and roster complete" : "Checklist or roster incomplete"}</Badge>
          <Badge variant={overview.checklist_gates_readiness ? "amber" : "grey"}>{overview.checklist_gates_readiness ? "Checklist gates the on-call cover guard" : "Checklist gates nothing yet"}</Badge>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Hours in the next 7 days with nobody on duty at the ops desk: {overview.uncovered_hours_next_7_days}.</li>
          <li>
            Page incidents given to a person: {overview.assignments}; acknowledged: {overview.acknowledged}; moved on to the deputy because the primary did not answer in time: {overview.moved_to_deputy}.
            {overview.median_seconds_to_acknowledge !== null ? ` Middle time to acknowledge: ${Math.round(overview.median_seconds_to_acknowledge / 60)} minutes.` : ""}
          </li>
          <li>Calls recorded: {overview.calls_logged}; answered: {overview.calls_answered}.</li>
          {overview.open_uncovered_incidents > 0 ? <li className="text-red-700 dark:text-red-300">{overview.open_uncovered_incidents} open incident(s) say nobody was named for the hour. Fix the roster below.</li> : null}
        </ul>
      </Section>

      {mode === "admin" ? (
        <Section title="Pages that need a phone call" hint="Each one means a priority page ran out of alerts, or nobody reachable is on call. Phone the people listed, in order, and record each call.">
          {incidentsFailed ? <p className="text-sm text-red-700 dark:text-red-300">The list could not be read. Open the incident register and use the paper list.</p> : null}
          {!incidentsFailed && incidents.length === 0 ? <Muted>Nothing needs a call right now.</Muted> : null}
          <div className="space-y-3">
            {incidents.map((i) => (
              <IncidentCard key={i.id} inc={i} sheet={sheets.get(i.id) ?? null} me={profile?.id ?? null} path={path} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Named ops contacts" hint="Hours are in Lagos time. A contact becomes active only when their own phone number is confirmed on their account and at least one window of hours is set. Numbers are read from the person's account, never typed here.">
        {roster.length === 0 ? <Muted>Nobody is named yet. Until someone is, a page that expires goes to every administrator and the clinical lead with no one assigned to phone.</Muted> : null}
        <div className="space-y-3">
          {roster.map((c) => (
            <div key={c.contact_id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge variant="grey">{c.role === "primary" ? "Primary" : "Deputy"}</Badge>
                <Badge variant={c.is_active ? "green" : "grey"}>{c.is_active ? "Active" : "Not active"}</Badge>
                {c.on_duty_now ? <Badge variant="green">On duty now</Badge> : null}
                <Badge variant={c.phone_status === "confirmed" ? "green" : "amber"}>
                  {c.phone_status === "confirmed" ? `Phone confirmed ${c.phone}` : c.phone_status === "no_number" ? "No phone number on the account" : "Phone number not confirmed"}
                </Badge>
              </div>
              <p>{windowsText(c)}</p>
              {c.is_active && c.activated_by_name ? <Muted>Activated by {c.activated_by_name}{c.activated_at ? ` on ${formatLagos(c.activated_at)}` : ""}.</Muted> : null}
              {mode === "admin" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <form action={setWindows} className="space-y-2">
                    <Hidden name="returnTo" value={path} />
                    <Hidden name="contact" value={c.contact_id} />
                    <Field label="Hours (one per line)" hint="Like: 1 08:00-18:00. 1 is Monday, 7 is Sunday. For a night, write two lines.">
                      <textarea name="windows" rows={4} defaultValue={windowsInput(c)} className={`${fieldClass} h-auto py-2`} />
                    </Field>
                    <SubmitButton tone="outline">Save hours</SubmitButton>
                  </form>
                  <form action={setContactActive} className="space-y-2">
                    <Hidden name="returnTo" value={path} />
                    <Hidden name="contact" value={c.contact_id} />
                    <Hidden name="active" value={c.is_active ? "no" : "yes"} />
                    {c.is_active ? null : (
                      <Field label="How were the number and hours checked?" hint="For example: phoned them on the number shown and they answered.">
                        <input name="note" minLength={10} required className={fieldClass} />
                      </Field>
                    )}
                    <SubmitButton tone={c.is_active ? "outline" : "default"}>{c.is_active ? "Make not active" : "Make active"}</SubmitButton>
                  </form>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {mode === "admin" ? (
          <form action={saveContact} className="grid gap-2 sm:grid-cols-3">
            <Hidden name="returnTo" value={path} />
            <Field label="Administrator to add">
              <select name="profile" className={fieldClass} required defaultValue="">
                <option value="" disabled>Choose</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name ?? p.id}</option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select name="role" className={fieldClass} defaultValue="primary">
                <option value="primary">Primary</option>
                <option value="deputy">Deputy</option>
              </select>
            </Field>
            <div className="flex items-end"><SubmitButton>Add as inactive</SubmitButton></div>
          </form>
        ) : null}
      </Section>

      <Section title="Resilience checklist" hint="Each line is a statement by a named person with a date and what they saw. The system does not know whether the power or the second link exists; it only records who said so. Statements go stale after a while and need repeating.">
        <div className="space-y-3">
          {overview.checklist.map((it) => (
            <div key={it.item_key} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{it.title}</span>
                <Badge variant={it.state === "in_place" && !it.stale ? "green" : it.state === "not_attested" ? "grey" : "amber"}>{it.stale ? "Out of date" : CHECK_LABEL[it.state]}</Badge>
              </div>
              <p className="text-charcoal-ink/70 dark:text-night-ink/70">{it.detail}</p>
              {it.attested_at ? <Muted>{it.attested_by_name} on {formatLagos(it.attested_at)}: {it.evidence_note}</Muted> : null}
              <form action={attestItem} className="grid gap-2 sm:grid-cols-4">
                <Hidden name="returnTo" value={path} />
                <Hidden name="item" value={it.item_key} />
                <Field label="Your statement">
                  <select name="state" className={fieldClass} defaultValue="in_place">
                    <option value="in_place">It is in place</option>
                    <option value="not_in_place">It is not in place</option>
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="What you saw or tested (at least 20 characters)">
                    <input name="evidence" minLength={20} required className={fieldClass} />
                  </Field>
                </div>
                <div className="flex items-end"><SubmitButton tone="outline">Record under my name</SubmitButton></div>
              </form>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Call log" hint="Who phoned whom, when, and what happened. Lines cannot be changed or removed.">
        {calls.length === 0 ? <Muted>No call has been recorded yet.</Muted> : null}
        {calls.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/15">
                  <th scope="col" className="py-1 pr-3 font-medium">When</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Incident</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Phoned by</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Phoned</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Outcome</th>
                  <th scope="col" className="py-1 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-b border-charcoal-ink/10">
                    <td className="py-1 pr-3">{formatLagos(c.called_at)}</td>
                    <td className="py-1 pr-3">{c.incident_reference}</td>
                    <td className="py-1 pr-3">{c.called_by_name}</td>
                    <td className="py-1 pr-3">{c.callee_name} ({CALLEE_KIND_LABEL[c.callee_kind]}){c.callee_phone_masked ? ` ${c.callee_phone_masked}` : ""}</td>
                    <td className="py-1 pr-3">{CALL_OUTCOME_LABEL[c.outcome]}</td>
                    <td className="py-1">{c.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
