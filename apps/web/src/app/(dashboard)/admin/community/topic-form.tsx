"use client";

import { ActionForm } from "./action-form";
import { saveTopicAction } from "./actions";
import { field, help, label } from "./ui";

export type TopicValues = { code: string; label: string; description: string | null; sort_order: number; is_active: boolean; requires_cmo_rules: boolean };

export function TopicForm({ topic, idPrefix }: { topic?: TopicValues; idPrefix: string }) {
  const p = idPrefix;
  return (
    <ActionForm action={saveTopicAction} submitLabel={topic ? "Save topic" : "Add topic"} pendingLabel="Saving...">
      <div>
        <label htmlFor={`${p}-code`} className={label}>Code</label>
        {topic ? (
          <>
            <input id={`${p}-code`} name="code" readOnly value={topic.code} className={`${field} bg-charcoal-ink/5`} />
          </>
        ) : (
          <>
            <input id={`${p}-code`} name="code" required pattern="[a-z0-9]+(_[a-z0-9]+)*" aria-describedby={`${p}-code-help`} className={field} />
            <p id={`${p}-code-help`} className={help}>Lowercase letters, numbers and underscores. It cannot be changed later.</p>
          </>
        )}
      </div>
      <div>
        <label htmlFor={`${p}-label`} className={label}>Label</label>
        <input id={`${p}-label`} name="label" required maxLength={80} defaultValue={topic?.label ?? ""} className={field} />
      </div>
      <div>
        <label htmlFor={`${p}-desc`} className={label}>Description</label>
        <textarea id={`${p}-desc`} name="description" rows={2} maxLength={500} defaultValue={topic?.description ?? ""} className={field} />
      </div>
      <div>
        <label htmlFor={`${p}-sort`} className={label}>Sort order</label>
        <input id={`${p}-sort`} name="sort_order" type="number" min={0} defaultValue={topic?.sort_order ?? 100} className={field} />
      </div>
      <div className="flex items-center gap-2">
        <input id={`${p}-active`} name="is_active" type="checkbox" defaultChecked={topic?.is_active ?? true} />
        <label htmlFor={`${p}-active`} className="text-sm text-charcoal-ink">Active (can be chosen for new groups)</label>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <input id={`${p}-cmo`} name="requires_cmo_rules" type="checkbox" defaultChecked={topic?.requires_cmo_rules ?? false} aria-describedby={`${p}-cmo-help`} />
          <label htmlFor={`${p}-cmo`} className="text-sm text-charcoal-ink">Group rules need Chief Medical Officer approval</label>
        </div>
        <p id={`${p}-cmo-help`} className={help}>Groups on this topic cannot go live until the Chief Medical Officer approves their rules. You can turn this on, but only the Chief Medical Officer can turn it off.</p>
      </div>
    </ActionForm>
  );
}
