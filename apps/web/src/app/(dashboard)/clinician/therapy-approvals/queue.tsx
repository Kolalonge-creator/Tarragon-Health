"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { koboToNaira } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Psychiatry booking requests waiting on a doctor.
 *
 * WHY THIS GATE EXISTS AT ALL. Psychology is self-bookable on this platform:
 * self-referral to counselling is ordinary and safe. Psychiatry is not, because
 * it involves diagnosis and prescribing, so a patient's request creates a row
 * in 'awaiting_clinician_approval' and stops there until a doctor decides.
 *
 * WHO MAY DECIDE. Senior Medical Officer or above only. That is enforced by
 * private.enforce_therapy_approver_authority, a trigger, not by this page and
 * not only by the RPC it calls -- an authority rule that lives in a screen is a
 * convention. A Care Coordinator can see this queue and will be refused if they
 * try to act on it, which is the correct shape: they route work, they do not
 * close clinical decisions.
 *
 * WHAT THE DOCTOR IS NOT BEING ASKED. They are not being asked to pick a
 * practitioner. The patient chose one from a filtered directory; this platform
 * has a standing guardrail against a specialist matching or ranking engine, and
 * a screen that invited a doctor to substitute their own choice would be the
 * thin end of exactly that.
 */

type Session = {
  id: string;
  organisation_id: string;
  patient_id: string;
  provider_id: string;
  status: string;
  modality: string;
  requested_at: string;
  fee_kobo: number;
  patient_note: string | null;
  patient: { full_name: string | null; patient_number: string | null } | null;
  provider: { name: string | null; specialist_type: string | null } | null;
};

function useAwaitingApproval() {
  return useQuery({
    queryKey: ["therapy", "awaiting-approval"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("therapy_sessions")
        .select(
          "*, patient:profiles!therapy_sessions_patient_id_fkey(full_name, patient_number), provider:therapy_directory(name, specialist_type)"
        )
        .eq("status", "awaiting_clinician_approval")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Session[];
    },
  });
}

function useDecide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, confirm }: { id: string; confirm: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("approve_therapy_session", {
        p_session_id: id,
        p_confirm: confirm,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["therapy", "awaiting-approval"] });
    },
  });
}

function SessionRow({ session }: { session: Session }) {
  const decide = useDecide();

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              {session.patient?.full_name ?? "Patient"}
            </p>
            {session.patient?.patient_number ? (
              <span className="font-mono text-xs text-charcoal-ink/50 dark:text-night-ink/50">
                {session.patient.patient_number}
              </span>
            ) : null}
            <Badge variant="amber">Psychiatry</Badge>
          </div>
          <p className="mt-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            Asked to see {session.provider?.name ?? "a practitioner"}
            {session.fee_kobo
              ? `, ₦${koboToNaira(session.fee_kobo).toLocaleString("en-NG")} a session`
              : ""}
            .
          </p>
          <p className="mt-0.5 text-xs text-charcoal-ink/55 dark:text-night-ink/55">
            Requested{" "}
            {formatPatientDate(new Date(session.requested_at), {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {session.patient_note ? (
            <p className="mt-1 rounded bg-charcoal-ink/[0.04] p-2 text-xs italic text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70">
              &ldquo;{session.patient_note}&rdquo;
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ id: session.id, confirm: false })}
          >
            Not now
          </Button>
          <Button
            size="sm"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ id: session.id, confirm: true })}
          >
            {decide.isPending ? "Saving…" : "Approve"}
          </Button>
        </div>
      </div>
      {decide.isError ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {(decide.error as Error).message}
        </p>
      ) : null}
    </li>
  );
}

export function TherapyApprovalQueue() {
  const { data, isLoading, isError } = useAwaitingApproval();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Psychiatry requests waiting</CardTitle>
        <CardDescription>
          A patient has asked to see a psychiatrist from the verified network. Counselling with a
          psychologist needs no approval and does not appear here. You are deciding whether psychiatry
          is the right next step, not which practitioner they should see; they have already chosen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-400">Could not load the queue.</p>
        )}
        {!isLoading && !isError && (data ?? []).length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Nothing waiting on a decision.
          </p>
        )}
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {(data ?? []).map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
