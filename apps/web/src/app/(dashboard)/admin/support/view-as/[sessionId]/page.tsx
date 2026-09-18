import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EndSessionButton } from "./end-session-button";
import { SessionCountdown } from "./session-countdown";

export const metadata = { title: "Support view-as session" };

function computeIsActive(session: { ended_at: string | null; expires_at: string }): boolean {
  return !session.ended_at && new Date(session.expires_at).getTime() > Date.now();
}

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

  const isActive = computeIsActive(session);

  const [
    { data: subject },
    { data: vitals },
    { data: medications },
    { data: appointments },
    { data: screenings },
    { data: notifications },
    { data: clinicalStaff },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, phone, city, state, patient_number, organisation_id, created_at, is_active")
      .eq("id", session.subject_id)
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Viewing: ${subject?.full_name ?? "Unknown"}`}
        description="Read-only account summary. Nothing on this page can be edited — there is no write action anywhere in this tool."
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
            This session ended {shortDate(session.ended_at ?? session.expires_at)}. The data below is what was
            visible while it was active and may be stale — start a new session from{" "}
            <Link href="/admin/support/view-as" className="underline">
              Support view-as
            </Link>{" "}
            for a fresh read.
          </CardContent>
        </Card>
      )}

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
                    {v.systolic ? ` — ${v.systolic}/${v.diastolic} mmHg` : ""}
                    {v.pulse_bpm ? ` — ${v.pulse_bpm} bpm` : ""}
                    {v.glucose_mmol_l ? ` — ${v.glucose_mmol_l} mmol/L` : ""}
                    {v.spo2_pct ? ` — ${v.spo2_pct}%` : ""}
                    {v.temperature_c ? ` — ${v.temperature_c}°C` : ""}
                    {v.weight_kg ? ` — ${v.weight_kg} kg` : ""}
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
    </div>
  );
}
