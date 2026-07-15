"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOrgSpecialistReferrals,
  useMatchedSpecialistProviders,
  useAssignSpecialistProvider,
  useSetReferralAppointment,
  useCloseReferral,
  type SpecialistReferralWithDetails,
} from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { koboToNaira, type ReferralStatus } from "@tarragon/shared";

const REFERRAL_STATUS_BADGE: Record<ReferralStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Needs specialist assigned" },
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Ready to book" },
  booked: { variant: "blue", label: "Booked" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  declined: { variant: "grey", label: "Declined" },
};

function AssignProviderForm({ referral }: { referral: SpecialistReferralWithDetails }) {
  const [state, setState] = useState("");
  const [requireTelemedicine, setRequireTelemedicine] = useState(false);
  const { data: providers, isLoading } = useMatchedSpecialistProviders({
    specialistType: referral.specialist_type,
    state: state || undefined,
    requireTelemedicine,
  });
  const assign = useAssignSpecialistProvider();
  const [providerId, setProviderId] = useState("");

  const chosen = providers?.find((p) => p.id === providerId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`state-${referral.id}`}>State</Label>
          <Input
            id={`state-${referral.id}`}
            placeholder="e.g. Lagos"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-32"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-charcoal-ink/70">
          <input
            type="checkbox"
            checked={requireTelemedicine}
            onChange={(e) => setRequireTelemedicine(e.target.checked)}
          />
          Telemedicine only
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`provider-${referral.id}`}>Specialist provider</Label>
          {isLoading && <p className="text-xs text-charcoal-ink/60">Loading providers…</p>}
          {!isLoading && (providers?.length ?? 0) === 0 && (
            <p className="text-xs text-charcoal-ink/60">No active providers match these filters yet.</p>
          )}
          {!isLoading && (providers?.length ?? 0) > 0 && (
            <Select id={`provider-${referral.id}`} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Select a provider</option>
              {providers!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.state ? ` · ${p.state}` : ""}
                  {p.supports_telemedicine ? " · telemedicine" : ""} — ₦
                  {koboToNaira(p.consultation_fee_kobo).toLocaleString()}
                </option>
              ))}
            </Select>
          )}
        </div>
        <Button
          size="sm"
          disabled={!chosen || assign.isPending}
          onClick={() =>
            chosen &&
            assign.mutate({
              referralId: referral.id,
              organisationId: referral.organisation_id,
              specialistProviderId: chosen.id,
              feeKobo: chosen.consultation_fee_kobo,
            })
          }
        >
          {assign.isPending ? "Assigning…" : "Assign"}
        </Button>
      </div>
      {assign.isError && <p className="w-full text-xs text-red-600">Could not assign. Try again.</p>}
    </div>
  );
}

function AppointmentForm({ referral }: { referral: SpecialistReferralWithDetails }) {
  const setAppointment = useSetReferralAppointment();
  const [date, setDate] = useState("");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor={`date-${referral.id}`}>Appointment date</Label>
        <Input
          id={`date-${referral.id}`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <Button
        size="sm"
        disabled={!date || setAppointment.isPending}
        onClick={() => setAppointment.mutate({ referralId: referral.id, appointmentDate: date })}
      >
        {setAppointment.isPending ? "Saving…" : "Confirm appointment"}
      </Button>
      {setAppointment.isError && <p className="w-full text-xs text-red-600">Could not save. Try again.</p>}
    </div>
  );
}

function CloseActions({ referral }: { referral: SpecialistReferralWithDetails }) {
  const close = useCloseReferral();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={close.isPending}
        onClick={() => close.mutate({ referralId: referral.id, status: "completed" })}
      >
        Mark completed
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={close.isPending}
        onClick={() => close.mutate({ referralId: referral.id, status: "declined" })}
      >
        Cancel
      </Button>
    </div>
  );
}

export default function ClinicianReferralsPage() {
  const { data, isLoading, isError } = useOrgSpecialistReferrals();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Specialist referrals</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load referrals.</p>}
        {data && data.length === 0 && <p className="text-sm text-charcoal-ink/60">No referrals yet.</p>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((referral) => {
              const statusBadge = REFERRAL_STATUS_BADGE[referral.status];
              return (
                <li key={referral.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    <span className="text-xs text-charcoal-ink/60">{referral.referral_number}</span>
                  </div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    <Link href={`/clinician/patients/${referral.patient_id}`} className="hover:underline">
                      {referral.patient?.full_name ?? "Unknown patient"}
                    </Link>{" "}
                    — {referral.specialist_type}
                  </p>
                  {referral.referral_reason && (
                    <p className="text-xs text-charcoal-ink/60">{referral.referral_reason}</p>
                  )}
                  {referral.specialist_provider && (
                    <p className="text-xs text-charcoal-ink/60">
                      Assigned to {referral.specialist_provider.name} · ₦
                      {koboToNaira(referral.referral_fee_kobo ?? 0).toLocaleString()}
                    </p>
                  )}
                  {referral.appointment_date && (
                    <p className="text-xs text-charcoal-ink/60">
                      Appointment: {new Date(referral.appointment_date).toLocaleDateString()}
                    </p>
                  )}
                  <Link
                    href={`/doctor/referrals/${referral.id}`}
                    className="text-xs text-brand-green hover:underline"
                  >
                    Set urgency &amp; clinical summary
                  </Link>
                  {referral.status === "pending" && <AssignProviderForm referral={referral} />}
                  {referral.status === "pending_payment" && (
                    <p className="text-xs text-charcoal-ink/60">Waiting on the patient to pay.</p>
                  )}
                  {referral.status === "payment_confirmed" && <AppointmentForm referral={referral} />}
                  {referral.status === "booked" && <CloseActions referral={referral} />}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
