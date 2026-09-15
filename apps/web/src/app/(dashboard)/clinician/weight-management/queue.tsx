"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Tolerability check-ins waiting to be read.
 *
 * WHAT THIS QUEUE IS AND IS NOT. It is a working list, not a safety mechanism.
 * A check-in reporting severe persistent abdominal pain, or persistent vomiting
 * with poor oral intake, already raised a clinician_alerts row with a 24-hour
 * SLA when it was submitted (private.raise_weight_checkin_red_flag). Nobody's
 * safety depends on a clinician happening to open this page, and it must stay
 * that way: if a future change makes something here the only route for an
 * urgent finding, the finding needs a trigger, not a better dashboard.
 *
 * Red flags are still sorted to the top, because a queue that buries the
 * important row is a badly built queue even when it is not the safety net.
 */

const SEVERITY_WORD = ["none", "mild", "moderate", "severe"] as const;

type Checkin = {
  id: string;
  organisation_id: string;
  patient_id: string;
  enrolment_id: string;
  checked_in_at: string;
  weight_kg: number | null;
  nausea: number | null;
  vomiting: number | null;
  diarrhoea: number | null;
  constipation: number | null;
  abdominal_pain: number | null;
  poor_oral_intake: boolean;
  red_flag_reported: boolean;
  patient_note: string | null;
  reviewed_at: string | null;
  patient: { full_name: string | null; patient_number: string | null } | null;
};

function useUnreviewedCheckins() {
  return useQuery({
    queryKey: ["weight-management", "queue"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("weight_management_checkins")
        .select(
          "*, patient:profiles!weight_management_checkins_patient_id_fkey(full_name, patient_number)"
        )
        .is("reviewed_at", null)
        .order("checked_in_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return data as unknown as Checkin[];
    },
  });
}

function useReviewCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const supabase = createClient();
      // The RPC stamps reviewed_by from the session and the authority rule lives
      // in a trigger, so a Care Coordinator is refused on any path, not only
      // this one.
      const { error } = await supabase.rpc("review_weight_management_checkin", {
        p_checkin_id: id,
        p_note: note && note.length > 0 ? note : undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["weight-management", "queue"] });
    },
  });
}

function symptomLine(checkin: Checkin): string {
  const parts: string[] = [];
  const add = (label: string, score: number | null) => {
    if (score && score > 0) parts.push(`${label} ${SEVERITY_WORD[score] ?? score}`);
  };
  add("nausea", checkin.nausea);
  add("vomiting", checkin.vomiting);
  add("diarrhoea", checkin.diarrhoea);
  add("constipation", checkin.constipation);
  add("stomach pain", checkin.abdominal_pain);
  return parts.length > 0 ? parts.join(", ") : "No symptoms reported";
}

function CheckinRow({ checkin }: { checkin: Checkin }) {
  const review = useReviewCheckin();
  const [note, setNote] = useState("");

  const urgent = checkin.red_flag_reported || (checkin.poor_oral_intake && (checkin.vomiting ?? 0) >= 2);

  return (
    <li className={`py-4 ${urgent ? "-mx-4 border-l-2 border-red-500 bg-red-50/50 px-4 dark:bg-red-950/20" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              {checkin.patient?.full_name ?? "Patient"}
            </p>
            {checkin.patient?.patient_number ? (
              <span className="font-mono text-xs text-charcoal-ink/50 dark:text-night-ink/50">
                {checkin.patient.patient_number}
              </span>
            ) : null}
            {checkin.red_flag_reported ? <Badge variant="red">Red flag</Badge> : null}
            {checkin.poor_oral_intake ? <Badge variant="amber">Not keeping fluids down</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {formatPatientDate(new Date(checkin.checked_in_at), {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {checkin.weight_kg ? ` · ${checkin.weight_kg} kg` : ""}
          </p>
          <p className="mt-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {symptomLine(checkin)}
          </p>
          {checkin.patient_note ? (
            <p className="mt-1 rounded bg-charcoal-ink/[0.04] p-2 text-xs italic text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70">
              &ldquo;{checkin.patient_note}&rdquo;
            </p>
          ) : null}
          {urgent ? (
            <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">
              An alert was already raised for this when it was submitted. Reviewing it here does not
              close that alert.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Your note (optional)"
          className="h-9 max-w-md flex-1"
        />
        <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: checkin.id, note })}>
          {review.isPending ? "Saving…" : "Mark reviewed"}
        </Button>
      </div>
      {review.isError ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {(review.error as Error).message}
        </p>
      ) : null}
    </li>
  );
}

export function WeightManagementQueue() {
  const { data, isLoading, isError } = useUnreviewedCheckins();

  // Red flags first, then oldest first. Both matter: urgency, then fairness to
  // whoever has been waiting longest.
  const sorted = [...(data ?? [])].sort((a, b) => {
    const aUrgent = a.red_flag_reported || (a.poor_oral_intake && (a.vomiting ?? 0) >= 2);
    const bUrgent = b.red_flag_reported || (b.poor_oral_intake && (b.vomiting ?? 0) >= 2);
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    return a.checked_in_at.localeCompare(b.checked_in_at);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tolerability check-ins waiting</CardTitle>
        <CardDescription>
          Patients in supervised weight management, sorted with anything urgent first and then
          oldest first. Anything urgent has already raised its own alert; this list is for reading
          and signing off, not for catching emergencies.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-400">Could not load the queue.</p>
        )}
        {!isLoading && !isError && sorted.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Nothing waiting. Every check-in has been read.
          </p>
        )}
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {sorted.map((checkin) => (
            <CheckinRow key={checkin.id} checkin={checkin} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
