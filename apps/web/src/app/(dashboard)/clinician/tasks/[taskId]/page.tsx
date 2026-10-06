import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PatientSummaryView } from "@/components/clinician/patient-summary";
import { DEDICATED_FLOW_TASK_TYPES, heldTaskSchema, minutesLeft, patientSummarySchema, slaState, TASK_SUMMARY_READ_REASON, uuidSchema } from "@/lib/clinician/queue-console";
import { CompleteForm, ExtendForm, HandBackForm } from "../../queue/forms";

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
    return (
      <div className="space-y-3">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("task.title", "en")}</h1>
        <p role={error ? "alert" : "status"} className="text-sm text-charcoal-ink/70">
          {error ? t("queue.load_error", "en") : t("task.not_held", "en")}
        </p>
        <Link href="/clinician/queue" className="text-sm font-medium text-brand-green underline">{t("queue.title", "en")}</Link>
      </div>
    );
  }
  const task = parsed.data;

  const summaryRes = await supabase.rpc("clinician_patient_summary", { p_patient: task.patient_id, p_reason: TASK_SUMMARY_READ_REASON });
  const summary = summaryRes.error ? null : patientSummarySchema.safeParse(summaryRes.data);
  const left = minutesLeft(task.claim_expires_at, new Date());
  const dedicatedFlow = DEDICATED_FLOW_TASK_TYPES[task.type];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{task.type.replace(/_/g, " ")}</h1>
        <Badge variant={task.priority_class === 1 ? "red" : "blue"}>{t("queue.class", "en", { n: task.priority_class ?? "?" })}</Badge>
        {slaState(task.due_at, new Date()).kind === "overdue" && <Badge variant="red">{t("queue.overdue", "en")}</Badge>}
        {task.rule_set_version !== null && task.rule_set_version !== undefined && (
          <span className="text-xs text-charcoal-ink/60">{t("task.rule_version", "en", { version: task.rule_set_version })}</span>
        )}
      </div>
      <p className="text-sm text-charcoal-ink/70">
        {task.due_at && <>{t("task.due", "en")} {dateTime(task.due_at)}. </>}
        {left !== null && (left === 0 ? t("queue.expired", "en") : t("queue.time_left", "en", { minutes: left }))}
      </p>
      <ExtendForm taskId={task.id} />

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
          ) : (
            <CompleteForm taskId={task.id} />
          )}
        </CardContent>
      </Card>
      <HandBackForm taskId={task.id} />
    </div>
  );
}
