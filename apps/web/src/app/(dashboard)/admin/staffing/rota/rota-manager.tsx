"use client";

import { useState } from "react";
import {
  useOrgRotaShifts,
  useEligibleRotaClinicians,
  useCreateRotaShift,
  useDeleteRotaShift,
  useCurrentOnCall,
  type RotaChannel,
} from "@/lib/queries/clinician-rota";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const CHANNEL_LABEL: Record<RotaChannel, string> = {
  video: "Video only",
  voice: "Voice only",
  both: "Video & voice",
};

function formatWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  };
  return `${start.toLocaleString(undefined, opts)} → ${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function OnCallBanner() {
  const { data: videoOnCall, isLoading: videoLoading } = useCurrentOnCall("video");
  const { data: voiceOnCall, isLoading: voiceLoading } = useCurrentOnCall("voice");

  const noVideoCoverage = !videoLoading && (videoOnCall?.length ?? 0) === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Right now</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
            On call for video
          </p>
          {videoLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {noVideoCoverage && (
            <Badge variant="red">No one is currently on call — video visits still accept org-wide</Badge>
          )}
          {!videoLoading && (videoOnCall?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {videoOnCall!.map((c) => (
                <Badge key={c.clinical_staff_id} variant="green">
                  {c.full_name}
                  {c.doctor_tier ? ` · ${DOCTOR_TIER_LABEL[c.doctor_tier]}` : ""}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
            On call for voice
          </p>
          {voiceLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {!voiceLoading && (voiceOnCall?.length ?? 0) === 0 && (
            <p className="text-sm text-charcoal-ink/60">No one scheduled.</p>
          )}
          {!voiceLoading && (voiceOnCall?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {voiceOnCall!.map((c) => (
                <Badge key={c.clinical_staff_id} variant="blue">
                  {c.full_name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateShiftForm() {
  const { data: clinicians } = useEligibleRotaClinicians();
  const create = useCreateRotaShift();
  const [clinicalStaffId, setClinicalStaffId] = useState("");
  const [channel, setChannel] = useState<RotaChannel>("video");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const canSubmit = clinicalStaffId && startsAt && endsAt;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a shift</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="rota-clinician">Clinician</Label>
            <Select
              id="rota-clinician"
              value={clinicalStaffId}
              onChange={(e) => setClinicalStaffId(e.target.value)}
            >
              <option value="">Select a clinician…</option>
              {(clinicians ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                  {c.is_clinical_director ? " (Clinical Director)" : c.doctor_tier ? ` — ${DOCTOR_TIER_LABEL[c.doctor_tier]}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rota-channel">Covers</Label>
            <Select
              id="rota-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as RotaChannel)}
            >
              {(Object.keys(CHANNEL_LABEL) as RotaChannel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rota-start">Starts</Label>
            <Input
              id="rota-start"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rota-end">Ends</Label>
            <Input
              id="rota-end"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        </div>
        <Button
          disabled={!canSubmit || create.isPending}
          onClick={() =>
            create.mutate(
              { clinicalStaffId, channel, startsAt, endsAt },
              {
                onSuccess: () => {
                  setClinicalStaffId("");
                  setStartsAt("");
                  setEndsAt("");
                },
              }
            )
          }
        >
          {create.isPending ? "Adding…" : "Add shift"}
        </Button>
        {create.isError && (
          <p className="text-sm text-red-600">
            {(create.error as Error).message || "Could not add that shift."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ShiftList() {
  const { data: shifts, isLoading } = useOrgRotaShifts();
  const remove = useDeleteRotaShift();
  // Captured once on mount so the render stays pure (lint: no Date.now() in
  // render) — a shift list doesn't need a live-ticking clock.
  const [now] = useState(() => Date.now());
  const upcoming = (shifts ?? []).filter((s) => new Date(s.ends_at).getTime() > now);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming &amp; active shifts</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && upcoming.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No shifts scheduled yet.</p>
        )}
        {upcoming.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {upcoming.map((shift) => {
              const active = new Date(shift.starts_at).getTime() <= now;
              return (
                <li key={shift.id} className="flex flex-wrap items-center gap-2 py-3">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {shift.clinician?.full_name ?? "Unknown clinician"}
                  </p>
                  <Badge variant={active ? "green" : "grey"}>
                    {active ? "On call now" : "Scheduled"}
                  </Badge>
                  <Badge variant="blue">{CHANNEL_LABEL[shift.channel as RotaChannel]}</Badge>
                  <p className="text-sm text-charcoal-ink/70">
                    {formatWindow(shift.starts_at, shift.ends_at)}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(shift.id)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RotaManager() {
  return (
    <div className="space-y-6">
      <OnCallBanner />
      <CreateShiftForm />
      <ShiftList />
    </div>
  );
}
