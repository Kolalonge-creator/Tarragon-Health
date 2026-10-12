import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionForm } from "@/components/testing-days/action-form";
import { staffEventListSchema, type StaffEvent } from "@/lib/testing-days/model";
import {
  approveVenue,
  createTestingEvent,
  saveTeam,
  setEventStatus,
  updateTestingEvent,
  addVisitAttendees,
} from "@/lib/testing-days/actions";

export const metadata = { title: "Testing days and employer visits" };

const STATUS_BADGE: Record<StaffEvent["status"], "grey" | "amber" | "green" | "blue"> = {
  requested: "amber",
  scheduled: "blue",
  open: "green",
  closed: "grey",
  completed: "grey",
  cancelled: "grey",
};
const NEXT_STATUS: Record<StaffEvent["status"], StaffEvent["status"][]> = {
  requested: ["scheduled", "cancelled"],
  scheduled: ["open", "completed", "cancelled"],
  open: ["closed", "completed", "cancelled"],
  closed: ["open", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export default async function TestingDaysSettingsPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already blocks non-admins from /admin/**; this is defence in depth, and the database functions check the
  // testing_days.manage permission on every write anyway.
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const { data: raw } = await supabase.rpc("list_testing_events_for_staff");
  const events = staffEventListSchema.catch([]).parse(raw ?? []);
  const { data: labs } = await supabase.from("lab_providers").select("id, name, is_active").order("name");
  const { data: staff } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["admin", "care_coordinator", "clinician"])
    .eq("is_active", true)
    .order("full_name");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Testing days and employer visits"
        description="Schedule the days Members book, approve each venue, open a day to Members, and run the stations on the day. A day cannot open until its venue is approved and it has a laboratory that is switched on."
      />

      <Card>
        <CardHeader>
          <CardTitle>New testing day</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createTestingEvent} submitLabel="Create testing day" hidden={{ kind: "public_day" }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="eventDate">Date</Label>
                <Input id="eventDate" name="eventDate" type="date" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="startsAt">From</Label>
                <Input id="startsAt" name="startsAt" type="time" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="endsAt">To</Label>
                <Input id="endsAt" name="endsAt" type="time" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="venueName">Venue</Label>
                <Input id="venueName" name="venueName" required />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" name="address" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lga">LGA</Label>
                <Input id="lga" name="lga" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="state">State</Label>
                <Input id="state" name="state" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="capacity">Capacity</Label>
                <Input id="capacity" name="capacity" type="number" min={1} max={500} defaultValue={30} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="labProviderId">Laboratory</Label>
                <Select id="labProviderId" name="labProviderId" defaultValue="">
                  <option value="">Choose a laboratory</option>
                  {(labs ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.is_active ? "" : " (not active)"}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <section aria-labelledby="all-events" className="space-y-3">
        <h2 id="all-events" className="font-heading text-lg font-semibold text-charcoal-ink">
          All events
        </h2>
        {events.length === 0 ? <p className="text-sm text-charcoal-ink/60">Nothing scheduled yet.</p> : null}
        {events.map((e) => (
          <Card key={e.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {e.event_date} · {e.venue_name}, {e.city}
                <Badge variant={STATUS_BADGE[e.status]}>{e.status}</Badge>
                <Badge variant="grey">{e.kind === "public_day" ? "Testing day" : "Employer visit"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-charcoal-ink/70">
                {e.address}. {e.seats_taken} of {e.capacity} places taken
                {e.waitlisted ? `, ${e.waitlisted} waiting` : ""}.{" "}
                {e.kind === "employer_visit" && e.headcount_requested ? `Employer asked for ${e.headcount_requested}. ` : ""}
                {e.venue_approved ? "Venue approved." : "Venue not approved yet."}
              </p>
              <div className="flex flex-wrap items-start gap-4">
                {!e.venue_approved && (e.status === "requested" || e.status === "scheduled") ? (
                  <ActionForm action={approveVenue} hidden={{ eventId: e.id }} submitLabel="Approve venue" variant="outline" />
                ) : null}
                {NEXT_STATUS[e.status].map((next) => (
                  <ActionForm
                    key={next}
                    action={setEventStatus}
                    hidden={{ eventId: e.id, status: next }}
                    submitLabel={`Mark ${next}`}
                    variant="outline"
                  />
                ))}
                <Link href={`/admin/testing-days/${e.id}`} className="self-center text-sm font-medium text-brand-green underline">
                  Run the stations
                </Link>
              </div>

              {e.status === "requested" || e.status === "scheduled" || e.status === "open" ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">Laboratory, capacity and times</summary>
                  <div className="pt-3">
                    <ActionForm action={updateTestingEvent} hidden={{ eventId: e.id }} submitLabel="Save" variant="outline">
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="space-y-1">
                          <Label htmlFor={`lab-${e.id}`}>Laboratory</Label>
                          <Select id={`lab-${e.id}`} name="labProviderId" defaultValue={e.lab_provider_id ?? ""}>
                            <option value="">No change</option>
                            {(labs ?? []).map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`cap-${e.id}`}>Capacity</Label>
                          <Input id={`cap-${e.id}`} name="capacity" type="number" min={1} max={500} defaultValue={e.capacity} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`from-${e.id}`}>From</Label>
                          <Input id={`from-${e.id}`} name="startsAt" type="time" />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`to-${e.id}`}>To</Label>
                          <Input id={`to-${e.id}`} name="endsAt" type="time" />
                        </div>
                      </div>
                    </ActionForm>
                  </div>
                </details>
              ) : null}

              {e.status !== "completed" && e.status !== "cancelled" ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">Team for the day</summary>
                  <div className="pt-3">
                    <ActionForm action={saveTeam} hidden={{ eventId: e.id }} submitLabel="Save team" variant="outline">
                      <div className="grid gap-3 sm:grid-cols-4">
                        {(
                          [
                            ["lead", "Lead"],
                            ["stationA", "Station A: registration"],
                            ["stationB", "Station B: point of care"],
                            ["stationC", "Station C: blood draw"],
                          ] as const
                        ).map(([name, label]) => (
                          <div key={name} className="space-y-1">
                            <Label htmlFor={`${name}-${e.id}`}>{label}</Label>
                            <Select id={`${name}-${e.id}`} name={name} defaultValue="">
                              <option value="">Nobody</option>
                              {(staff ?? []).map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.full_name ?? s.id}
                                </option>
                              ))}
                            </Select>
                          </div>
                        ))}
                      </div>
                    </ActionForm>
                  </div>
                </details>
              ) : null}

              {e.kind === "employer_visit" && (e.status === "scheduled" || e.status === "open") ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">Add roster employees</summary>
                  <div className="space-y-2 pt-3">
                    <p className="text-xs text-charcoal-ink/60">
                      Paste roster ids, one per line. Only people who have claimed their account and hold a Membership are added; the rest are
                      counted, not named.
                    </p>
                    <ActionForm action={addVisitAttendees} hidden={{ eventId: e.id }} submitLabel="Add to visit" variant="outline">
                      <textarea
                        name="rosterIds"
                        rows={4}
                        aria-label="Roster ids"
                        className="w-full rounded-md border border-charcoal-ink/20 bg-white p-2 text-sm"
                      />
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
