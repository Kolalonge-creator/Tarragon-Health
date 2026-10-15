import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formatMinutes, taskTypeSchema, TASK_TYPE_LABEL, TIER_LABEL, type TaskTypeRow } from "@/lib/queue/task-types";
import { confirmTaskTypeAction } from "@/app/(dashboard)/clinician/triage-rules/actions";
import { createTaskTypeProposalAction } from "@/lib/queue/task-type-actions";

type TableReader = { from(table: string): { select(columns: string): { eq(column: string, value: boolean): PromiseLike<{ data: unknown; error: { message: string } | null }> } } };

const COLUMNS = "code, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note, needs_confirmation, confirmed_at, confirmation_note";

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
export async function TaskTypesPage({ canConfirm = false, done, error, returnTo = "/clinician/task-types" }: { canConfirm?: boolean; done?: string; error?: string; returnTo?: string }) {
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
      {done && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{done}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      <details className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
        <summary className="cursor-pointer font-heading text-base font-semibold text-charcoal-ink">Propose a new task type</summary>
        <p className="mt-2 max-w-3xl text-xs text-charcoal-ink/60">
          A new kind of clinical work is added here, not in code. It appears in the queue with the class you set and waits for the Chief Medical Officer to confirm it.
          Nothing is confirmed by proposing.
        </p>
        <form action={createTaskTypeProposalAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="block text-xs">
            Code (lower case, underscores)
            <input name="code" required pattern="[a-z][a-z0-9_]{2,60}" className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <label className="block text-xs">
            Priority class (1 is first, 9 is last)
            <input name="priorityClass" type="number" min={1} max={9} required className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <label className="block text-xs">
            Expected within (minutes)
            <input name="defaultDueMinutes" type="number" min={0} required className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <label className="block text-xs">
            Who may take it
            <select name="minTier" defaultValue="medical_officer" className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink">
              {(Object.keys(TIER_LABEL) as Array<keyof typeof TIER_LABEL>).map((k) => (
                <option key={k} value={k}>
                  {TIER_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Skills needed (comma separated)
            <input name="requiredCompetencies" className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <label className="block text-xs">
            Named clinician first for (minutes)
            <input name="leadWindowMinutes" type="number" min={0} defaultValue={0} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <label className="block text-xs">
            Claim held for (minutes)
            <input name="claimTimeoutMinutes" type="number" min={1} defaultValue={30} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <label className="block text-xs">
            Created from triage keys (comma separated, optional)
            <input name="sourceTaskKeys" className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input name="pushable" type="checkbox" /> Can be offered to an employed doctor
          </label>
          <label className="block text-xs sm:col-span-2">
            Note (optional)
            <input name="note" maxLength={500} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
              Propose task type
            </button>
          </div>
        </form>
      </details>
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
              {t.needs_confirmation && !t.confirmed_at && (
                <div className="mt-3 space-y-2 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <p>Not in the original specification. It must be confirmed by the Chief Medical Officer before the triage rule set can be signed.</p>
                  {canConfirm ? (
                    <form action={confirmTaskTypeAction} className="space-y-2">
                      <input type="hidden" name="code" value={t.code} />
                      <label className="block text-xs">
                        Note (optional)
                        <input name="note" maxLength={500} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-charcoal-ink" />
                      </label>
                      <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
                        Confirm this task type
                      </button>
                    </form>
                  ) : (
                    <p className="text-xs">Only the Chief Medical Officer can confirm it.</p>
                  )}
                </div>
              )}
              {t.needs_confirmation && t.confirmed_at && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Confirmed by the Chief Medical Officer on {new Date(t.confirmed_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}.
                  {t.confirmation_note ? ` Note: ${t.confirmation_note}` : ""}
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
