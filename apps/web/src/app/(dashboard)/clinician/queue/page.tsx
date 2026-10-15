import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SlaBadge } from "@/components/clinician/sla-badge";
import { formatKobo } from "@/lib/format-money";
import { blockedReasonKey, classCounts, escalatedTaskSchema, heldTaskSchema, minutesLeft, queueSummarySchema } from "@/lib/clinician/queue-console";
import { ExtendForm, NextTaskForm } from "./forms";
import { OpsModeBanner } from "@/components/capacity/ops-mode-banner";

export const metadata = { title: "Queue" };
export const dynamic = "force-dynamic";

const dateTime = (value: string): string =>
  new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * The clinician's queue (S35, spec 9.1): counts by priority class, whether the queue is open for me, the next task fee
 * (contracted clinicians only), the Next task button and the task I hold. The page never lists other people's tasks and
 * never shows a patient: a patient appears only inside a task I hold. Red events are paged, not pulled (INV-05), so
 * this page links to On call instead of listing them.
 */
export default async function ClinicianQueuePage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const raw = await searchParams;
  const supabase = loose(await createClient());

  // the clinical lead also sees every escalated task with its age (the database refuses anyone else)
  const isLead = canAssignCases(await getCurrentClinicalStaff());
  const [summaryRes, escalatedRes, heldRes] = await Promise.all([
    supabase.rpc("queue_summary"),
    isLead ? supabase.rpc("queue_escalated_overview") : Promise.resolve(null),
    supabase
      .from("clinical_tasks")
      .select("id, type, priority_class, due_at, claim_expires_at, task_type_version, rule_set_version, patient_id, state")
      .eq("claimed_by", profile.id)
      .in("state", ["claimed", "escalated"])
      .order("claim_expires_at", { ascending: true }),
  ]);
  const summary = summaryRes.error ? null : queueSummarySchema.safeParse(summaryRes.data);
  const held = heldRes.error ? null : heldTaskSchema.array().safeParse(heldRes.data);
  const escalated = escalatedRes ? (escalatedRes.error ? null : escalatedTaskSchema.array().safeParse(escalatedRes.data)) : null;
  const now = new Date();
  const counts = summary?.success ? classCounts(summary.data.by_class) : null;
  const blockedKey = summary?.success && !summary.data.open ? blockedReasonKey(summary.data.blocked) : null;

  return (
    <div className="space-y-6">
      <OpsModeBanner />
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("queue.title", "en")}</h1>
        <p className="text-sm text-charcoal-ink/60">{t("queue.subtitle", "en")}</p>
        <p className="text-xs text-charcoal-ink/50">
          {t("queue.updated", "en", { time: now.toLocaleTimeString("en-GB", { timeStyle: "short", timeZone: "Africa/Lagos" }) })}
        </p>
      </div>

      {first(raw.none) === "1" && <p role="status" className="text-sm text-charcoal-ink/70">{t("queue.none", "en")}</p>}
      {first(raw.handed_back) === "1" && <p role="status" className="text-sm text-brand-green">{t("queue.handed_back", "en")}</p>}
      {first(raw.done) === "1" && <p role="status" className="text-sm text-brand-green">{t("task.completed", "en")}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{t("queue.waiting_by_class", "en")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!summary?.success && (
            <p role="alert" className="text-sm text-red-600">{t("queue.load_error", "en")}</p>
          )}
          {summary?.success && counts && (
            <>
              <div className="flex flex-wrap gap-2">
                {counts.rows.map((r) => (
                  <Badge key={r.key} variant={r.key === "1" ? "red" : "blue"}>
                    {t("queue.class", "en", { n: r.key })}: {r.count}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-charcoal-ink/70">{t("queue.total_waiting", "en", { count: counts.total })}</p>
              {summary.data.open ? (
                <p className="text-sm text-charcoal-ink">{t("queue.open_yes", "en")}</p>
              ) : (
                <div role="status" className="space-y-1 rounded-md border border-charcoal-ink/10 p-3">
                  <p className="text-sm font-medium text-charcoal-ink">{t("queue.blocked.title", "en")}</p>
                  <p className="text-sm text-charcoal-ink">{t(blockedKey ?? "queue.blocked.other", "en")}</p>
                  {summary.data.cooling_off_until && (
                    <p className="text-sm text-charcoal-ink/70">
                      {t("queue.cooling_off_until", "en", { time: new Date(summary.data.cooling_off_until).toLocaleTimeString("en-GB", { timeStyle: "short", timeZone: "Africa/Lagos" }) })}
                    </p>
                  )}
                </div>
              )}
              {typeof summary.data.next_fee_kobo === "number" && (
                <p className="text-sm text-charcoal-ink">{t("queue.fee_next", "en", { amount: formatKobo(summary.data.next_fee_kobo) })}</p>
              )}
            </>
          )}
          <NextTaskForm />
          <p className="flex gap-4 text-sm">
            <Link href="/clinician/on-call" className="font-medium text-brand-green underline">{t("queue.links_on_call", "en")}</Link>
            <Link href="/clinician/rota" className="font-medium text-brand-green underline">{t("queue.links_rota", "en")}</Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("queue.current_title", "en")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!held?.success && <p role="alert" className="text-sm text-red-600">{t("queue.load_error", "en")}</p>}
          {held?.success && held.data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">{t("queue.current_none", "en")}</p>
          )}
          {held?.success && held.data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {held.data.map((task) => {
                const left = minutesLeft(task.claim_expires_at, now);
                return (
                  <li key={task.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Badge variant={task.priority_class === 1 ? "red" : "blue"}>
                      {t("queue.class", "en", { n: task.priority_class ?? "?" })}
                    </Badge>
                    <span className="text-sm font-medium text-charcoal-ink">{task.type.replace(/_/g, " ")}</span>
                    {task.due_at && <span className="text-xs text-charcoal-ink/60">{t("task.due", "en")} {dateTime(task.due_at)}</span>}
                    <SlaBadge dueAt={task.due_at} now={now} />
                    {left !== null && (
                      <span className="text-xs text-charcoal-ink/60">
                        {left === 0 ? t("queue.expired", "en") : t("queue.time_left", "en", { minutes: left })}
                      </span>
                    )}
                    <ExtendForm taskId={task.id} />
                    <Link href={`/clinician/tasks/${task.id}`} className="ml-auto text-sm font-medium text-brand-green underline">
                      {t("queue.open_task", "en")}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {summary?.success && (
        <Card>
          <CardHeader>
            <CardTitle>{t("queue.offered_title", "en")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-charcoal-ink/70">{t("queue.offered_hint", "en")}</p>
            {(summary.data.offered ?? []).length === 0 && <p className="text-sm text-charcoal-ink/60">{t("queue.offered_none", "en")}</p>}
            {(summary.data.offered ?? []).length > 0 && (
              <ul className="divide-y divide-charcoal-ink/10">
                {(summary.data.offered ?? []).map((task) => (
                  <li key={task.task_id} className="flex flex-wrap items-center gap-3 py-2">
                    <Badge variant="blue">{t("queue.class", "en", { n: task.priority_class ?? "?" })}</Badge>
                    <span className="text-sm font-medium text-charcoal-ink">{task.type.replace(/_/g, " ")}</span>
                    {task.window_ends_at && (
                      <span className="text-xs text-charcoal-ink/60">{t("queue.offered_window", "en", { time: dateTime(task.window_ends_at) })}</span>
                    )}
                    <SlaBadge dueAt={task.due_at} now={now} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-charcoal-ink/70">
              {(summary.data.escalated_claimable ?? 0) > 0
                ? t("queue.escalated_claimable", "en", { count: summary.data.escalated_claimable ?? 0 })
                : t("queue.escalated_none", "en")}
            </p>
          </CardContent>
        </Card>
      )}

      {summary?.success && typeof summary.data.reliability_score === "number" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("queue.reliability_title", "en")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-charcoal-ink">{t("queue.reliability_body", "en", { score: Math.round(summary.data.reliability_score) })}</p>
          </CardContent>
        </Card>
      )}

      {isLead && (
        <Card>
          <CardHeader>
            <CardTitle>{t("queue.escalated_lead_title", "en")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-charcoal-ink/70">{t("queue.escalated_lead_hint", "en")}</p>
            {!escalated?.success && <p role="alert" className="text-sm text-red-600">{t("queue.load_error", "en")}</p>}
            {escalated?.success && escalated.data.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("queue.escalated_lead_none", "en")}</p>}
            {escalated?.success && escalated.data.length > 0 && (
              <ul className="divide-y divide-charcoal-ink/10">
                {escalated.data.map((task) => (
                  <li key={task.task_id} className="flex flex-wrap items-center gap-3 py-2">
                    <Badge variant={task.priority_class === 1 ? "red" : "blue"}>{t("queue.class", "en", { n: task.priority_class })}</Badge>
                    <span className="text-sm font-medium text-charcoal-ink">{task.type.replace(/_/g, " ")}</span>
                    {task.age_minutes !== null && <span className="text-xs text-charcoal-ink/60">{t("queue.escalated_age", "en", { minutes: task.age_minutes })}</span>}
                    <SlaBadge dueAt={task.due_at} now={now} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
