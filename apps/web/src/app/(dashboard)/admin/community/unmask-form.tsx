"use client";

import { useState } from "react";
import { ActionForm } from "./action-form";
import { unmaskAction } from "./actions";
import type { ActionState } from "./state";
import { btnQuiet, field, help, label, warn } from "./ui";

export const IDENTITY_WARNING =
  "Do not type the member's name, phone number, email or any detail that identifies them in the reason. Say why you need to reach them (for example: a safety review). The reason can be read by other staff.";

function Result({ state }: { state: ActionState }) {
  const [hidden, setHidden] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  if (!state?.ok || !state.result || hidden === state) return null;
  const r = state.result;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${r.full_name ?? ""} ${r.profile_id}`.trim());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section aria-labelledby="unmask-result" className="mt-3 rounded-xl border border-charcoal-ink/25 bg-white p-4">
      <h3 id="unmask-result" className="font-semibold text-charcoal-ink">Result (shown once)</h3>
      <dl className="mt-2 text-sm text-charcoal-ink">
        <dt className="font-medium">Name</dt>
        <dd>{r.full_name ?? "No name on record"}</dd>
        <dt className="mt-2 font-medium">Profile id</dt>
        <dd className="break-all font-mono text-xs">{r.profile_id}</dd>
      </dl>
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={copy} className={btnQuiet}>Copy</button>
        <button type="button" onClick={() => setHidden(state)} className={btnQuiet}>Clear this result</button>
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-charcoal-ink/70">{copied ? "Copied." : ""}</p>
      <p className="mt-2 text-sm text-charcoal-ink">This lookup was recorded in the audit log with your written reason, without the member&apos;s name, and the Chief Medical Officer has been told. Leaving this page clears the result.</p>
    </section>
  );
}

export function UnmaskForm({ groups }: { groups: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm
      action={unmaskAction}
      submitLabel="Look up this member"
      pendingLabel="Looking up..."
      confirm={`This lookup is recorded in the audit log and the Chief Medical Officer is told. ${IDENTITY_WARNING} Continue?`}
      renderResult={(s) => <Result state={s} />}
    >
      <p className={warn} role="note">
        Every lookup is recorded in the audit log and the Chief Medical Officer is told. Use this only when there is a real need, such as a safety review.
      </p>
      <div>
        <label htmlFor="um-group" className={label}>Group</label>
        <select id="um-group" name="group_id" required defaultValue="" className={field}>
          <option value="" disabled>Choose a group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="um-handle" className={label}>Community name</label>
        <input id="um-handle" name="handle" required autoComplete="off" className={field} />
      </div>
      <div>
        <label htmlFor="um-reason" className={label}>Written reason</label>
        <textarea id="um-reason" name="reason" required rows={4} aria-describedby="um-reason-help" className={field} />
        <p id="um-reason-help" className={help}>
          {IDENTITY_WARNING} The reason must be long enough to explain the need; a very short one is refused.
        </p>
      </div>
    </ActionForm>
  );
}
