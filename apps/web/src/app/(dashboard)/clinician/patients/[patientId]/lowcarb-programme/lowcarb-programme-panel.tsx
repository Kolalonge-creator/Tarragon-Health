import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeLowCarbEvent, loadLowCarbProgramme } from "@/lib/lowcarb/programme";
import { OfferForm, PauseButton, ResumeButton, ReviewForm, StopButton, SupervisionForm } from "./lowcarb-controls";

const STATUS_LABEL: Record<string, string> = {
  offered: "Offered, waiting for the patient",
  active: "Running",
  paused: "Paused",
  stopped: "Stopped",
  declined: "Declined",
  expired: "Lapsed",
};
const CHECKIN_LABEL: Record<string, string> = { glucose: "Sugar", ketones: "Ketones", weight: "Weight" };
const CHECKIN_STATUS: Record<string, string> = { on_track: "On track", due: "Due", overdue: "Overdue" };

/**
 * S50b: the low-carbohydrate programme for type 2 diabetes on the clinician chart (spec 6.10). Dormant: it shows one quiet line until the
 * go-live guard is on and the Chief Medical Officer has signed the protocol. The read is audited (INV-10) and tie-gated (INV-12); a refusal is
 * shown as unavailable, never as "no programme". The platform only PROPOSES medicine changes, as unsigned drafts under Care plan changes.
 */
export async function LowCarbProgrammePanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const loaded = await loadLowCarbProgramme(supabase, patientId);
  if (loaded.status === "denied") return null;
  if (loaded.status === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Low-carbohydrate programme</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-red-700">
            {loaded.message} Please refresh.
          </p>
        </CardContent>
      </Card>
    );
  }
  const { programme, checkins } = loaded;
  const e = programme.enrolment;
  const open = e !== null && ["offered", "active", "paused"].includes(e.status);
  // Nothing to say before the programme is switched on: one quiet line, no controls.
  if (!programme.guard_open && !open) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Low-carbohydrate programme (type 2 diabetes)</CardTitle>
        <CardDescription>
          A supervised programme. The platform raises review tasks and unsigned drafts only. Every medicine change is signed by a prescriber and confirmed by the patient.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!programme.config_signed ? (
          <p className="text-sm">The programme protocol has not been signed yet, so it cannot be offered.</p>
        ) : null}

        {e ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={e.status === "active" ? "green" : e.status === "paused" ? "amber" : "blue"}>{STATUS_LABEL[e.status] ?? e.status}</Badge>
              {e.supervision_accepted ? <Badge variant="blue">Medicines supervised</Badge> : null}
            </div>
            {e.last_medicine_review_at ? (
              <p className="text-sm text-charcoal-ink/70">Medicines last reviewed {new Date(e.last_medicine_review_at).toLocaleDateString("en-NG")}.</p>
            ) : (
              <p className="text-sm text-charcoal-ink/70">No medicine review recorded yet.</p>
            )}
          </div>
        ) : null}

        {e && (e.status === "active" || e.status === "paused") ? (
          checkins ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-3">
              {checkins.map((c) => (
                <li key={c.metric} className="rounded-lg border p-2">
                  <span className="font-medium">{CHECKIN_LABEL[c.metric]}</span>: {c.countThisWeek} of {c.expected} this week
                  <br />
                  <Badge variant={c.status === "on_track" ? "green" : c.status === "due" ? "amber" : "red"}>{CHECKIN_STATUS[c.status]}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">The readings could not be read just now, so the check-ins are not shown.</p>
          )
        ) : null}

        {programme.can_act && programme.config_signed ? (
          <div className="space-y-4">
            {!open ? <OfferForm patientId={patientId} /> : null}
            {e && e.status === "active" ? <PauseButton patientId={patientId} enrolmentId={e.id} /> : null}
            {e && e.status === "paused" ? <SupervisionForm patientId={patientId} enrolmentId={e.id} /> : null}
            {e && e.status === "paused" ? <ResumeButton patientId={patientId} enrolmentId={e.id} /> : null}
            {e && (e.status === "active" || e.status === "paused") ? <ReviewForm patientId={patientId} enrolmentId={e.id} /> : null}
            {e && open ? <StopButton patientId={patientId} enrolmentId={e.id} label={e.status === "offered" ? "Withdraw the offer" : "Stop the programme"} /> : null}
          </div>
        ) : programme.config_signed ? (
          <p className="text-sm">Only a prescriber tied to this patient can run the programme.</p>
        ) : null}

        {programme.events.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold">History</h4>
            <ul className="mt-1 space-y-1 text-sm">
              {programme.events.slice(0, 10).map((ev, i) => (
                <li key={`${ev.at}-${i}`}>
                  {new Date(ev.at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}: {describeLowCarbEvent(ev.kind, ev.code)}{ev.note ? `. ${ev.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
