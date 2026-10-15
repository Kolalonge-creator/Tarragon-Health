"use client";

import { useActionState, useId, useState } from "react";
import { IDENTITY_WARNING, UNMASK_REASON_MIN, kindWords, type UnmaskCandidate, type UnmaskState } from "./unmask-shared";

const btn = "rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-50";
const btnPrimary = `${btn} bg-brand-green text-white`;
const btnQuiet = `${btn} border border-charcoal-ink/25 bg-white text-charcoal-ink`;
const fieldCls = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const labelCls = "block text-sm font-medium text-charcoal-ink";
const helpCls = "mt-1 text-xs text-charcoal-ink/70";

export type UnmaskAction = (prev: UnmaskState, formData: FormData) => Promise<UnmaskState>;

const CONFIRM = `This lookup is written down with your reason, and the Chief Medical Officer and the data protection officer are told. ${IDENTITY_WARNING} Continue?`;

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

function Result({ state, showProfileId }: { state: UnmaskState; showProfileId: boolean }) {
  const [hidden, setHidden] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const headingId = useId();
  if (!state?.ok || !state.result || hidden === state) return null;
  const r = state.result;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${r.full_name ?? ""} ${showProfileId ? (r.profile_id ?? "") : ""}`.trim());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section aria-labelledby={headingId} className="mt-3 rounded-xl border border-charcoal-ink/25 bg-white p-4">
      <h3 id={headingId} className="font-semibold text-charcoal-ink">Result (shown once)</h3>
      <dl className="mt-2 text-sm text-charcoal-ink">
        <dt className="font-medium">Name</dt>
        <dd>{r.full_name ?? "No name on record"}</dd>
        {showProfileId && r.profile_id && (
          <>
            <dt className="mt-2 font-medium">Profile id</dt>
            <dd className="break-all font-mono text-xs">{r.profile_id}</dd>
          </>
        )}
      </dl>
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={copy} className={btnQuiet}>Copy</button>
        <button type="button" onClick={() => setHidden(state)} className={btnQuiet}>Clear this result</button>
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-charcoal-ink/70">{copied ? "Copied." : ""}</p>
      <p className="mt-2 text-sm text-charcoal-ink">
        This lookup was recorded with your written reason. The Chief Medical Officer and the data protection officer were told. Leaving this page clears the result.
      </p>
    </section>
  );
}

function Message({ state }: { state: UnmaskState }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {state && !state.ok && (
        <p role="alert" className="mt-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <span className="font-semibold">Not done. </span>
          {state.message}
        </p>
      )}
    </div>
  );
}

/** One lookup form. `fixed` carries the group and name from a listed concern; without it the person types them (the fallback). */
function LookupForm({
  action, showProfileId, submitLabel, fixed, groups, prefix,
}: {
  action: UnmaskAction;
  showProfileId: boolean;
  submitLabel: string;
  fixed?: { groupId: string; handle: string };
  groups?: Array<{ id: string; name: string }>;
  prefix: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(e) => {
        if (!window.confirm(CONFIRM)) e.preventDefault();
      }}
    >
      {fixed ? (
        <>
          <input type="hidden" name="group_id" value={fixed.groupId} />
          <input type="hidden" name="handle" value={fixed.handle} />
        </>
      ) : (
        <>
          <div>
            <label htmlFor={`${prefix}-group`} className={labelCls}>Group</label>
            <select id={`${prefix}-group`} name="group_id" required defaultValue="" className={fieldCls}>
              <option value="" disabled>Choose a group</option>
              {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-handle`} className={labelCls}>Community name</label>
            <input id={`${prefix}-handle`} name="handle" required autoComplete="off" className={fieldCls} />
          </div>
        </>
      )}
      <div>
        <label htmlFor={`${prefix}-reason`} className={labelCls}>Written reason</label>
        <textarea id={`${prefix}-reason`} name="reason" required minLength={UNMASK_REASON_MIN} rows={3} aria-describedby={`${prefix}-reason-help`} className={fieldCls} />
        <p id={`${prefix}-reason-help`} className={helpCls}>
          At least {UNMASK_REASON_MIN} characters. {IDENTITY_WARNING}
        </p>
      </div>
      <button type="submit" disabled={pending} className={btnPrimary}>{pending ? "Looking up..." : submitLabel}</button>
      <Message state={state} />
      <Result state={state} showProfileId={showProfileId} />
    </form>
  );
}

/**
 * The list of recent safety concerns, each with its own lookup form. A name can be looked up only while the person has a recent safety
 * concern in that group. `candidates` is null when the list could not be loaded.
 */
export function UnmaskPanel({
  action, candidates, groups, showProfileId,
}: {
  action: UnmaskAction;
  candidates: UnmaskCandidate[] | null;
  groups?: Array<{ id: string; name: string }>;
  showProfileId: boolean;
}) {
  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="note">
        Every lookup is written down with your reason, and the Chief Medical Officer and the data protection officer are told. Use this only when someone may be in danger.
      </p>
      <section aria-labelledby="um-concerns">
        <h2 id="um-concerns" className="font-heading text-xl font-semibold text-charcoal-ink">Recent safety concerns</h2>
        {candidates === null ? (
          <p role="alert" className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">The safety concerns could not be loaded. Please reload the page. If it keeps happening, you may not have access.</p>
        ) : candidates.length === 0 ? (
          <p className="mt-2 text-sm text-charcoal-ink">There are no recent safety concerns, so no name can be looked up right now.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {candidates.map((c, i) => (
              <li key={c.signal_id} className="rounded-xl border border-charcoal-ink/15 bg-white p-4">
                <p className="text-sm font-semibold text-charcoal-ink">{kindWords(c.kind)}</p>
                <p className="mt-1 text-sm text-charcoal-ink">
                  Group: {c.group_name}. Community name: <span className="font-medium">{c.author_handle}</span>. {when(c.created_at)}
                </p>
                {c.body && (
                  <blockquote className="mt-2 whitespace-pre-wrap rounded-lg bg-charcoal-ink/5 p-3 text-sm text-charcoal-ink">{c.body}</blockquote>
                )}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-green">Look up this person</summary>
                  <div className="mt-3">
                    <LookupForm
                      action={action}
                      showProfileId={showProfileId}
                      submitLabel="Look up this person"
                      fixed={{ groupId: c.group_id, handle: c.author_handle }}
                      prefix={`um-c${i}`}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
      {groups && (
        <section aria-labelledby="um-manual">
          <details>
            <summary id="um-manual" className="cursor-pointer text-sm font-medium text-charcoal-ink">Look up by name and group</summary>
            <p className={`${helpCls} mt-2`}>This works only while the person has a recent safety concern in that group. If there is none, the lookup is refused.</p>
            <div className="mt-3 max-w-2xl">
              <LookupForm action={action} showProfileId={showProfileId} submitLabel="Look up this member" groups={groups} prefix="um-m" />
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
