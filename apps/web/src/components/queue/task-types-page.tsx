import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formatMinutes, taskTypeSchema, TASK_TYPE_LABEL, TIER_LABEL, UNCONFIRMED_TASK_TYPES, type TaskTypeRow } from "@/lib/queue/task-types";

type TableReader = { from(table: string): { select(columns: string): { eq(column: string, value: boolean): PromiseLike<{ data: unknown; error: { message: string } | null }> } } };

const COLUMNS = "code, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note";

async function loadTaskTypes(): Promise<{ rows: TaskTypeRow[]; failed: boolean }> {
  // task_types is not in the generated types yet (S16 added it); the rows are checked with Zod instead.
  const client = (await createClient()) as unknown as TableReader;
  const { data, error } = await client.from("task_types").select(COLUMNS).eq("is_active", true);
  if (error) return { rows: [], failed: true };
  const parsed = z.array(taskTypeSchema).safeParse(data);
  if (!parsed.success) return { rows: [], failed: true };
  return { rows: [...parsed.data].sort((a, b) => a.priority_class - b.priority_class || a.code.localeCompare(b.code)), failed: false };
}

/** Read-only list of the kinds of clinician work, shared by the admin and the Chief Medical Officer pages. */
export async function TaskTypesPage() {
  const { rows, failed } = await loadTaskTypes();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Task types and priorities</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          The kinds of clinical work the queue holds, how urgent each is (class 1 is first), how long it is expected to take to reach a clinician, and who may take it.
          These are proposed values, held as versioned data. Changing one is a new version, not an edit.
        </p>
      </div>
      {failed ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          The task types could not be loaded just now. Try again in a moment; nothing has been changed.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((t) => (
            <li key={t.code} id={t.code} className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-base font-semibold text-charcoal-ink">{TASK_TYPE_LABEL[t.code] ?? t.code}</h2>
                <span className="text-xs font-medium text-charcoal-ink/60">Class {t.priority_class}</span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-charcoal-ink/50">{t.code}</p>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Row label="Expected within" value={t.default_due_minutes === 0 ? "Immediately" : formatMinutes(t.default_due_minutes)} />
                <Row label="Who may take it" value={TIER_LABEL[t.min_doctor_tier]} />
                <Row label="Skills needed" value={t.required_competencies.length ? t.required_competencies.join(", ").replace(/_/g, " ") : "None specific"} />
                <Row label="Named clinician first for" value={formatMinutes(t.lead_window_minutes)} />
                <Row label="Claim held for" value={formatMinutes(t.claim_timeout_minutes)} />
                <Row label="Can be offered to an employed doctor" value={t.pushable ? "Yes" : "No"} />
                {t.source_task_keys.length > 0 && <Row label="Created from triage keys" value={t.source_task_keys.join(", ")} />}
                {!t.creatable && <Row label="Created directly" value="No, reached by promotion only" />}
              </dl>
              {t.note && <p className="mt-2 text-xs text-charcoal-ink/60">{t.note}</p>}
              {UNCONFIRMED_TASK_TYPES.includes(t.code) && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Not in the original specification. The Chief Medical Officer confirms its class and tier when signing the triage rule set.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-charcoal-ink/5 py-1 last:border-0">
      <dt className="text-charcoal-ink/60">{label}</dt>
      <dd className="text-right font-medium text-charcoal-ink">{value}</dd>
    </div>
  );
}
