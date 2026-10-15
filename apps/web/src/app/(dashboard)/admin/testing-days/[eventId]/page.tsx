import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionForm } from "@/components/testing-days/action-form";
import { BOOKING_STATE_LABEL, ECG_FILE_ACCEPT, rosterSchema, URINALYSIS_FIELDS, type RosterRow } from "@/lib/testing-days/model";
import {
  checkInBooking,
  recordBloodDraw,
  recordEcg,
  recordHba1c,
  recordMeasurements,
  recordUrinalysis,
} from "@/lib/testing-days/actions";

export const metadata = { title: "Run the stations" };

function Done({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant={ok ? "green" : "grey"}>{ok ? `${label}: done` : `${label}: to do`}</Badge>;
}

function Attendee({ row, eventId }: { row: RosterRow; eventId: string }) {
  const hidden = { bookingId: row.booking_id, eventId };
  const checkedIn = row.state === "checked_in";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {row.full_name ?? "Member"}
          <Badge variant={checkedIn ? "green" : "blue"}>{BOOKING_STATE_LABEL[row.state]}</Badge>
          {row.specimen_number ? <Badge variant="grey">Tube {row.specimen_number}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {row.state === "confirmed" ? (
          <section aria-label="Station A, registration">
            <h3 className="text-sm font-semibold text-charcoal-ink">Station A: registration</h3>
            <p className="pb-2 text-xs text-charcoal-ink/60">
              Confirm who they are, then check them in. This makes their annual check order and the labelled tube number.
            </p>
            <ActionForm action={checkInBooking} hidden={hidden} submitLabel="Check in" />
          </section>
        ) : null}

        {checkedIn ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Done ok={row.measurements} label="Readings" />
              <Done ok={row.urinalysis} label="Urine" />
              <Done ok={row.hba1c} label="HbA1c" />
              <Done ok={row.ecg} label="ECG" />
              <Done ok={row.blood_drawn} label="Blood draw" />
            </div>

            {!row.measurements ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-charcoal-ink">Station B: readings</summary>
                <div className="pt-3">
                  <ActionForm action={recordMeasurements} hidden={hidden} submitLabel="Save readings">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label htmlFor={`h-${row.booking_id}`}>Height (cm)</Label>
                        <Input id={`h-${row.booking_id}`} name="heightCm" type="number" step="0.1" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`w-${row.booking_id}`}>Weight (kg)</Label>
                        <Input id={`w-${row.booking_id}`} name="weightKg" type="number" step="0.1" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`p-${row.booking_id}`}>Pulse (per minute)</Label>
                        <Input id={`p-${row.booking_id}`} name="pulseBpm" type="number" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`o-${row.booking_id}`}>Oxygen saturation (%)</Label>
                        <Input id={`o-${row.booking_id}`} name="spo2Pct" type="number" />
                      </div>
                      {(["bp1", "bp2", "bp3"] as const).map((n, i) => (
                        <div key={n} className="space-y-1">
                          <Label htmlFor={`${n}-${row.booking_id}`}>Blood pressure {i + 1} (like 120/80)</Label>
                          <Input id={`${n}-${row.booking_id}`} name={n} placeholder="120/80" />
                        </div>
                      ))}
                      <div className="space-y-1">
                        <Label htmlFor={`g-${row.booking_id}`}>Glucose (mmol/L)</Label>
                        <Input id={`g-${row.booking_id}`} name="glucoseMmolL" type="number" step="0.1" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`gc-${row.booking_id}`}>Glucose taken</Label>
                        <Select id={`gc-${row.booking_id}`} name="glucoseContext" defaultValue="random">
                          <option value="fasting">Fasting</option>
                          <option value="random">Random</option>
                          <option value="post_meal">After a meal</option>
                          <option value="pre_meal">Before a meal</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`bd-${row.booking_id}`}>BP monitor used</Label>
                        <Input id={`bd-${row.booking_id}`} name="bpDevice" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`gd-${row.booking_id}`}>Glucose meter used</Label>
                        <Input id={`gd-${row.booking_id}`} name="glucoseDevice" />
                      </div>
                    </div>
                  </ActionForm>
                </div>
              </details>
            ) : null}

            {!row.urinalysis ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-charcoal-ink">Station B: urine strip</summary>
                <div className="pt-3">
                  <p className="pb-2 text-xs text-charcoal-ink/60">Enter what the strip shows. Leave a box empty if it was not read. The system decides what is normal.</p>
                  <ActionForm action={recordUrinalysis} hidden={hidden} submitLabel="Save urine test">
                    <div className="grid gap-3 sm:grid-cols-5">
                      {URINALYSIS_FIELDS.map((f) => (
                        <div key={f.code} className="space-y-1">
                          <Label htmlFor={`u-${f.code}-${row.booking_id}`}>{f.label}</Label>
                          {f.kind === "numeric" ? (
                            <Input id={`u-${f.code}-${row.booking_id}`} name={`u_${f.code}`} type="number" step="0.001" />
                          ) : (
                            <Select id={`u-${f.code}-${row.booking_id}`} name={`u_${f.code}`} defaultValue="">
                              <option value="">Not read</option>
                              {f.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>
                      ))}
                    </div>
                  </ActionForm>
                </div>
              </details>
            ) : null}

            {!row.hba1c ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-charcoal-ink">Station B: HbA1c (if measured)</summary>
                <div className="pt-3">
                  <ActionForm action={recordHba1c} hidden={hidden} submitLabel="Save HbA1c">
                    <div className="max-w-xs space-y-1">
                      <Label htmlFor={`a1c-${row.booking_id}`}>HbA1c (%)</Label>
                      <Input id={`a1c-${row.booking_id}`} name="value" type="number" step="0.1" />
                    </div>
                  </ActionForm>
                </div>
              </details>
            ) : null}

            {!row.ecg ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-charcoal-ink">Station B: ECG</summary>
                <div className="space-y-2 pt-3">
                  <p className="text-xs text-charcoal-ink/60">
                    Attach the trace the machine produced. It is not read by software: a doctor reads it and writes the interpretation.
                  </p>
                  <ActionForm action={recordEcg} hidden={hidden} submitLabel="Save ECG" encType="multipart/form-data">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`ecg-${row.booking_id}`}>ECG file</Label>
                        <Input id={`ecg-${row.booking_id}`} name="file" type="file" accept={ECG_FILE_ACCEPT} required />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`ecgd-${row.booking_id}`}>Machine used</Label>
                        <Input id={`ecgd-${row.booking_id}`} name="device" />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor={`ecgm-${row.booking_id}`}>Text printed on the trace (for the doctor; not shown to the member)</Label>
                        <Input id={`ecgm-${row.booking_id}`} name="machineStatement" />
                      </div>
                    </div>
                  </ActionForm>
                </div>
              </details>
            ) : null}

            {!row.blood_drawn ? (
              <section aria-label="Station C, blood draw">
                <h3 className="text-sm font-semibold text-charcoal-ink">Station C: blood draw</h3>
                <p className="pb-2 text-xs text-charcoal-ink/60">
                  Label every tube {row.specimen_number ?? "with the tube number"}, then record the draw.
                </p>
                <ActionForm action={recordBloodDraw} hidden={hidden} submitLabel="Blood drawn" />
              </section>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function StationsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  if (!/^[0-9a-f-]{36}$/.test(eventId)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("testing_event_roster", { p_event: eventId });
  if (error) redirect("/admin/settings/testing-days");
  const roster = rosterSchema.catch([]).parse(data ?? []);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/admin/settings/testing-days", label: "Testing days" }}
        title="Run the stations"
        description="A: register and check in. B: readings, urine strip, HbA1c and ECG. C: blood draw. Results stay with the care team until a doctor releases them."
      />
      {roster.length === 0 ? (
        <p className="text-sm text-charcoal-ink/60">
          Nobody has a place on this event yet.{" "}
          <Link href="/admin/settings/testing-days" className="underline">
            Back to the list
          </Link>
        </p>
      ) : null}
      {roster.map((r) => (
        <Attendee key={r.booking_id} row={r} eventId={eventId} />
      ))}
    </div>
  );
}
