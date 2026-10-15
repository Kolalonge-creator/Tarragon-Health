import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SlaBadge } from "@/components/clinician/sla-badge";
import { PatientSummaryView } from "@/components/clinician/patient-summary";
import { TriageExplainer } from "@/components/clinician/triage-explainer";
import { explainerSchema } from "@/lib/triage/explainer";
import { completionOptions, DEDICATED_FLOW_TASK_TYPES, SYSTEM_CLOSED_TASK_TYPES, heldTaskSchema, minutesLeft, patientSummarySchema, TASK_SUMMARY_READ_REASON, uuidSchema } from "@/lib/clinician/queue-console";
import { CompleteForm, ExtendForm, HandBackForm } from "../../queue/forms";
import { getRedPatientResponse } from "@/lib/paging/queries";
import { RedPatientAnswer } from "@/components/paging/red-patient-answer";

export const metadata = { title: "Task" };
export const dynamic = "force-dynamic";

const dateTime = (value: string): string =>
  new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

/**
 * One held task (S35, spec 9.1 "Task view"): the task facts, the patient summary, the outcome form and the hand-back.
 * Row security only returns a task I hold, so a task I do not hold (never claimed, timed out, handed back) is
 * indistinguishable from one that does not exist, and no patient is read for it: the summary is fetched only after the
 * task row came back (INV-12). The summary read is audited once per open (INV-10).
 */
export default async function ClinicianTaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { taskId } = await params;
  if (!uuidSchema.safeParse(taskId).success) redirect("/clinician/queue");

  const supabase = loose(await createClient());
  const { data, error } = await supabase
    .from("clinical_tasks")
    .select("id, type, priority_class, due_at, claim_expires_at, task_type_version, rule_set_version, patient_id, state")
    .eq("id", taskId)
    .eq("claimed_by", profile.id)
    .in("state", ["claimed", "escalated"])
    .maybeSingle();

  const parsed = !error && data ? heldTaskSchema.safeParse(data) : null;
  if (!parsed?.success) {
    // A task I no longer hold: say what became of it. This reads only my own claim, so it shows nothing about anyone else's work.
    const outcome = error ? null : await supabase.rpc("my_task_outcome", { p_task: taskId });
    const what = outcome && !outcome.error && typeof outcome.data === "string" ? outcome.data : null;
    const message = error
      ? t("queue.load_error", "en")
      : what === "withdrawn"
        ? t("task.withdrawn", "en")
        : what === "completed"
          ? t("task.already_finished", "en")
          : t("task.not_held", "en");
    return (
      <div className="space-y-3">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("task.title", "en")}</h1>
        <p role={error ? "alert" : "status"} className="text-sm text-charcoal-ink/70">
          {message}
        </p>
        <Link href="/clinician/queue" className="text-sm font-medium text-brand-green underline">{t("queue.title", "en")}</Link>
      </div>
    );
  }
  const task = parsed.data;

  const summaryRes = await supabase.rpc("clinician_patient_summary", { p_patient: task.patient_id, p_reason: TASK_SUMMARY_READ_REASON });
  const summary = summaryRes.error ? null : patientSummarySchema.safeParse(summaryRes.data);
  // P6: why the engine raised this task. One more audited read, after the task row proved the clinician holds it (INV-12). A failure
  // here shows a line of its own and never hides the task or the summary.
  const explainerRes = await supabase.rpc("clinician_task_triage_explainer", { p_task: task.id });
  const explainerParsed = explainerRes.error ? null : explainerSchema.safeParse(explainerRes.data);
  const explainer = explainerParsed?.success ? explainerParsed.data : null;
  // CMO Q13: for a red alert task, what the patient said about seeking care (information; it never closes the task)
  const redAnswer = task.type === "red_patient_outreach" || task.type === "red_event_unacknowledged" ? await getRedPatientResponse({ task: task.id }) : null;
  const left = minutesLeft(task.claim_expires_at, new Date());
  const dedicatedFlow = DEDICATED_FLOW_TASK_TYPES[task.type];
  const systemClosed = SYSTEM_CLOSED_TASK_TYPES[task.type];
  const completion = completionOptions(task.type);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{task.type.replace(/_/g, " ")}</h1>
        <Badge variant={task.priority_class === 1 ? "red" : "blue"}>{t("queue.class", "en", { n: task.priority_class ?? "?" })}</Badge>
        <SlaBadge dueAt={task.due_at} now={new Date()} />
        {task.rule_set_version !== null && task.rule_set_version !== undefined && (
          <span className="text-xs text-charcoal-ink/60">{t("task.rule_version", "en", { version: task.rule_set_version })}</span>
        )}
      </div>
      <p className="text-sm text-charcoal-ink/70">
        {task.due_at && <>{t("task.due", "en")} {dateTime(task.due_at)}. </>}
        {left !== null && (left === 0 ? t("queue.expired", "en") : t("queue.time_left", "en", { minutes: left }))}
      </p>
      <RedPatientAnswer answer={redAnswer} />
      <ExtendForm taskId={task.id} />

      <TriageExplainer explainer={explainer} />

      {!summary?.success && <p role="alert" className="text-sm text-red-600">{t("summary.load_error", "en")}</p>}
      {summary?.success && summary.data.status === "denied" && (
        <p role="alert" className="text-sm text-red-600">{t("summary.denied", "en")}</p>
      )}
      {summary?.success && summary.data.status !== "denied" && <PatientSummaryView summary={summary.data} />}

      <Card>
        <CardHeader><CardTitle>{t("task.complete_title", "en")}</CardTitle></CardHeader>
        <CardContent>
          {dedicatedFlow ? (
            <p className="text-sm text-charcoal-ink">
              {t("task.dedicated_flow", "en")}{" "}
              <Link href={dedicatedFlow} className="font-medium text-brand-green underline">{t("task.dedicated_link", "en")}</Link>
            </p>
          ) : systemClosed ? (
            <p className="text-sm text-charcoal-ink">
              {t(systemClosed.messageKey, "en")}{" "}
              <Link href={systemClosed.href(task.patient_id)} className="font-medium text-brand-green underline">{t(systemClosed.linkKey, "en")}</Link>
            </p>
          ) : (
            <>
              {completion.attemptsCode !== null && <p className="mb-2 text-xs text-charcoal-ink/60">{t("task.system_closed.results_hint", "en")}</p>}
              <CompleteForm taskId={task.id} options={completion} />
            </>
          )}
        </CardContent>
      </Card>
      <HandBackForm taskId={task.id} />
    </div>
  );
}
