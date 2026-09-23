import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isSupportViewSessionActive } from "@/lib/queries/support-view-as";
import { EndSessionButton } from "./end-session-button";
import { SessionCountdown } from "./session-countdown";

export const metadata = { title: "Support view-as session" };

function shortDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SupportViewAsSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const { data: session } = await supabase
    .from("support_view_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) notFound();

  // Only the viewer who started this session gets the interactive snapshot — a subject
  // or an unrelated admin who happens to be able to SEE this row (RLS also admits the
  // subject and any admin) does not get to browse the subject's data through it; the
  // read grant itself (private.can_support_view) checks viewer_id = auth.uid() too, so
  // this is a friendlier redirect rather than the only enforcement.
  if (session.viewer_id !== profile.id) {
    redirect("/admin/support/view-as");
  }

  const isActive = isSupportViewSessionActive(session);

  // Once a session has ended or expired, private.can_support_view() correctly stops granting
  // a read on the subject's data — that IS the read-only, time-boxed guarantee working as
  // designed, not a bug. Don't run the 7 live queries at all in that state (they'd just come
  // back empty/null, which would misleadingly look like "this patient has no vitals/
  // medications/..." rather than "this tool's access has ended"), and don't imply a frozen
  // snapshot exists — it doesn't; only session.subject_full_name/subject_role (immutable
  // snapshot columns on the session row itself, always readable by the viewer) survive.
  //
  // Fetched into a single named object (not a positional array/tuple) so adding, removing, or
  // reordering a query can't silently shift which variable gets which result.
  const snapshot = isActive
    ? await (async () => {
        const [
          { data: subject },
          { data: vitals },
          { data: medications },
          { data: appointments },
          { data: screenings },
          { data: notifications },
          { data: clinicalStaff },
        ] = await Promise.all([
          // Deliberately NOT a plain `.from("profiles").select(...)` — that would rely on a
          // row-level RLS grant, which would expose the subject's ENTIRE profiles row (including
          // hiv_status/hbv_status/hcv_status and emergency_contact_*) to any query the caller made
          // against the table directly, not just these curated columns. This RPC returns exactly
          // these columns server-side — see get_support_view_subject_identity() in
          // 20260922175144_support_view_as.sql.
          supabase
            .rpc("get_support_view_subject_identity", { p_subject_id: session.subject_id })
            .maybeSingle(),
          supabase
            .from("vitals_readings")
            .select("id, vital_type, source, taken_at, systolic, diastolic, pulse_bpm, glucose_mmol_l, spo2_pct, temperature_c, weight_kg")
            .eq("patient_id", session.subject_id)
            .order("taken_at", { ascending: false })
            .limit(20),
          supabase
            .from("medications")
            .select("id, drug_name, dose, frequency, is_active, created_at")
            .eq("patient_id", session.subject_id)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("appointments")
            .select("id, appointment_type, status, scheduled_for, consultation_method")
            .eq("patient_id", session.subject_id)
            .order("scheduled_for", { ascending: false })
            .limit(10),
          supabase
            .from("screening_schedules")
            .select("id, status, due_date, screen_types(name)")
            .eq("patient_id", session.subject_id)
            .order("due_date", { ascending: false })
            .limit(10),
          supabase
            .from("notifications")
            .select("id, channel, status, template, created_at, sent_at")
            .eq("recipient_id", session.subject_id)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("clinical_staff")
            .select("id, doctor_tier, active, credential_type, credential_number, license_verified_at")
            .eq("profile_id", session.subject_id)
            .maybeSingle(),
        ]);
        return { subject, vitals, medications, appointments, screenings, notifications, clinicalStaff };
      })()
    : {
        subject: null,
        vitals: null,
        medications: null,
        appointments: null,
        screenings: null,
        notifications: null,
        clinicalStaff: null,
      };
  const { subject, vitals, medications, appointments, screenings, notifications, clinicalStaff } = snapshot;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Viewing: ${session.subject_full_name ?? "Unnamed subject"}`}
        description="Read-only account summary. Nothing on this page can be edited: there is no write action anywhere in this tool."
        actions={
          isActive ? (
            <div className="flex items-center gap-3">
              <SessionCountdown expiresAt={session.expires_at} />
              <EndSessionButton sessionId={session.id} />
            </div>
          ) : (
            <Badge variant="grey">Session ended</Badge>
          )
        }
      />

      {!isActive && (
        <Card>
          <CardContent className="py-4 text-sm text-charcoal-ink/70">
            This session ended {shortDate(session.ended_at ?? session.expires_at)}. The read-only access it
            granted has ended too, so this account&apos;s data is no longer visible through this tool.
            Nothing below reflects what it actually contains (an empty card here means &ldquo;no longer
            accessible&rdquo;, not &ldquo;nothing on file&rdquo;). Reason given at the time:{" "}
            &ldquo;{session.reason}&rdquo;. Start a new session from{" "}
            <Link href="/admin/support/view-as" className="underline">
              Support view-as
            </Link>{" "}
            for a fresh, currently-authorised read.
          </CardContent>
        </Card>
      )}

      {isActive && (
      <>
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-charcoal-ink/50">Role:</span> {subject?.role ?? "—"}
            {subject?.is_active === false && (
              <Badge variant="grey" className="ml-2">
                Inactive
              </Badge>
            )}
          </p>
          <p>
            <span className="text-charcoal-ink/50">Phone:</span> {subject?.phone ?? "—"}
          </p>
          <p>
            <span className="text-charcoal-ink/50">Location:</span>{" "}
            {[subject?.city, subject?.state].filter(Boolean).join(", ") || "—"}
          </p>
          {subject?.patient_number && (
            <p>
              <span className="text-charcoal-ink/50">Patient number:</span> {subject.patient_number}
            </p>
          )}
          <p>
            <span className="text-charcoal-ink/50">Joined:</span> {shortDate(subject?.created_at ?? null)}
          </p>
        </CardContent>
      </Card>

      {clinicalStaff && (
        <Card>
          <CardHeader>
            <CardTitle>Clinical staff record</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-charcoal-ink/50">Tier:</span> {clinicalStaff.doctor_tier ?? "Not yet assigned"}{" "}
              <Badge variant={clinicalStaff.active ? "green" : "grey"} className="ml-1">
                {clinicalStaff.active ? "Active" : "Inactive"}
              </Badge>
            </p>
            <p>
              <span className="text-charcoal-ink/50">Credential:</span>{" "}
              {clinicalStaff.credential_type ?? "—"} {clinicalStaff.credential_number ?? ""}
            </p>
            <p>
              <span className="text-charcoal-ink/50">Licence verified:</span>{" "}
              {shortDate(clinicalStaff.license_verified_at)}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent vitals</CardTitle>
        </CardHeader>
        <CardContent>
          {!vitals || vitals.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No vitals readings.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {vitals.map((v) => (
                <li key={v.id} className="flex justify-between py-1.5">
                  <span>
                    {v.vital_type}
                    {v.systolic != null ? ` — ${v.systolic}/${v.diastolic ?? "—"} mmHg` : ""}
                    {v.pulse_bpm != null ? ` — ${v.pulse_bpm} bpm` : ""}
                    {v.glucose_mmol_l != null ? ` — ${v.glucose_mmol_l} mmol/L` : ""}
                    {v.spo2_pct != null ? ` — ${v.spo2_pct}%` : ""}
                    {v.temperature_c != null ? ` — ${v.temperature_c}°C` : ""}
                    {v.weight_kg != null ? ` — ${v.weight_kg} kg` : ""}
                    <span className="ml-2 text-xs text-charcoal-ink/40">({v.source})</span>
                  </span>
                  <span className="text-charcoal-ink/50">{shortDate(v.taken_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Medications</CardTitle>
        </CardHeader>
        <CardContent>
          {!medications || medications.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No medications on record.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {medications.map((m) => (
                <li key={m.id} className="flex justify-between py-1.5">
                  <span>
                    {m.drug_name} — {m.dose ?? "—"} {m.frequency ?? ""}
                  </span>
                  <Badge variant={m.is_active ? "green" : "grey"}>{m.is_active ? "Active" : "Inactive"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appointments</CardTitle>
        </CardHeader>
        <CardContent>
          {!appointments || appointments.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No appointments on record.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {appointments.map((a) => (
                <li key={a.id} className="flex justify-between py-1.5">
                  <span>
                    {a.appointment_type} ({a.consultation_method})
                  </span>
                  <span className="text-charcoal-ink/50">
                    {shortDate(a.scheduled_for)} · {a.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Screening schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {!screenings || screenings.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No screenings scheduled.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {screenings.map((s) => {
                const screenType = s.screen_types as { name: string } | null;
                return (
                  <li key={s.id} className="flex justify-between py-1.5">
                    <span>{screenType?.name ?? "Screening"}</span>
                    <span className="text-charcoal-ink/50">
                      Due {shortDate(s.due_date)} · {s.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications they received</CardTitle>
        </CardHeader>
        <CardContent>
          {!notifications || notifications.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No notifications on record.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {notifications.map((n) => (
                <li key={n.id} className="flex justify-between py-1.5">
                  <span>
                    {n.template ?? "—"} <span className="text-xs text-charcoal-ink/40">({n.channel})</span>
                  </span>
                  <span className="text-charcoal-ink/50">
                    {shortDate(n.sent_at ?? n.created_at)} · {n.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
