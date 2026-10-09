"use client";

import { ActionForm } from "./action-form";
import { endPromptAction, savePromptAction } from "./actions";
import { PROMPT_MAX, PROMPT_MIN } from "./schemas";
import { btnQuiet, field, help, label } from "./ui";

/** Add a prompt to one group. Times are Lagos time. The database applies the same filters as for a member's post. */
export function AddPromptForm({ groupId, groupName }: { groupId: string; groupName: string }) {
  const p = `ap-${groupId}`;
  return (
    <ActionForm action={savePromptAction} submitLabel="Add prompt" pendingLabel="Adding...">
      <input type="hidden" name="group_id" value={groupId} />
      <div>
        <label htmlFor={`${p}-body`} className={label}>New prompt for {groupName}</label>
        <textarea
          id={`${p}-body`}
          name="body"
          required
          rows={3}
          minLength={PROMPT_MIN}
          maxLength={PROMPT_MAX}
          aria-describedby={`${p}-body-help`}
          className={field}
        />
        <p id={`${p}-body-help`} className={help}>
          {PROMPT_MIN} to {PROMPT_MAX} characters. No phone numbers, emails or links: it goes through the same filters as a member post.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${p}-from`} className={label}>Show from (optional)</label>
          <input id={`${p}-from`} name="show_from" type="datetime-local" aria-describedby={`${p}-time-help`} className={field} />
        </div>
        <div>
          <label htmlFor={`${p}-until`} className={label}>Show until (optional)</label>
          <input id={`${p}-until`} name="show_until" type="datetime-local" aria-describedby={`${p}-time-help`} className={field} />
        </div>
      </div>
      <p id={`${p}-time-help`} className={help}>Times are Lagos time. Leave the start empty to show it straight away, and the end empty to keep showing it until you end it.</p>
    </ActionForm>
  );
}

export function EndPromptForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={endPromptAction}
      submitLabel="End now"
      pendingLabel="Ending..."
      submitClassName={btnQuiet}
      className="space-y-2"
      confirm="End this prompt now? Members will stop seeing it straight away."
    >
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}
