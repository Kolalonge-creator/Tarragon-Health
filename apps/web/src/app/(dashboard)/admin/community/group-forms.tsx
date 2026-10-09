"use client";

import { ActionForm } from "./action-form";
import { createGroupAction, editGroupAction, setGroupStatusAction } from "./actions";
import { btnDanger, btnQuiet, field, help, label } from "./ui";

export type TopicOption = { code: string; label: string };

export function CreateGroupForm({ topics }: { topics: TopicOption[] }) {
  return (
    <ActionForm action={createGroupAction} submitLabel="Create group (as a draft)" pendingLabel="Creating...">
      <div>
        <label htmlFor="cg-name" className={label}>Name</label>
        <input id="cg-name" name="name" required maxLength={120} className={field} />
      </div>
      <div>
        <label htmlFor="cg-slug" className={label}>Address (slug)</label>
        <input id="cg-slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="cg-slug-help" className={field} />
        <p id="cg-slug-help" className={help}>Lowercase letters, numbers and hyphens only. It cannot be changed later.</p>
      </div>
      <div>
        <label htmlFor="cg-desc" className={label}>Description</label>
        <textarea id="cg-desc" name="description" rows={2} maxLength={1000} className={field} />
      </div>
      <div>
        <label htmlFor="cg-topic" className={label}>Topic</label>
        <select id="cg-topic" name="topic_code" required defaultValue="" className={field}>
          <option value="" disabled>Choose a topic</option>
          {topics.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="cg-rules" className={label}>Group rules</label>
        <textarea id="cg-rules" name="rules_text" required rows={5} className={field} />
      </div>
      <p className={help}>Joining is open to any adult member for now. A new group starts as a draft and is not visible to members.</p>
    </ActionForm>
  );
}

export function EditGroupForm({ group, topics }: { group: { id: string; slug: string; name: string; description: string; topic_code: string; rules_text: string }; topics: TopicOption[] }) {
  const p = `eg-${group.id}`;
  return (
    <ActionForm
      action={editGroupAction}
      submitLabel="Save changes"
      pendingLabel="Saving..."
      confirmIfChanged={{ name: "rules_text", initial: group.rules_text, message: "You changed the rules. Saving starts a new rules version and removes any Chief Medical Officer approval, so members will be asked to accept the new rules and a group that needs approval must be approved again. Save anyway?" }}
    >
      <input type="hidden" name="id" value={group.id} />
      <input type="hidden" name="slug" value={group.slug} />
      <div>
        <label htmlFor={`${p}-name`} className={label}>Name</label>
        <input id={`${p}-name`} name="name" required maxLength={120} defaultValue={group.name} className={field} />
      </div>
      <div>
        <label htmlFor={`${p}-desc`} className={label}>Description</label>
        <textarea id={`${p}-desc`} name="description" rows={2} maxLength={1000} defaultValue={group.description} className={field} />
      </div>
      <div>
        <label htmlFor={`${p}-topic`} className={label}>Topic</label>
        <select id={`${p}-topic`} name="topic_code" defaultValue={group.topic_code} className={field}>
          {topics.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${p}-rules`} className={label}>Group rules</label>
        <textarea id={`${p}-rules`} name="rules_text" required rows={5} defaultValue={group.rules_text} aria-describedby={`${p}-rules-help`} className={field} />
        <p id={`${p}-rules-help`} className="mt-1 text-xs font-medium text-amber-900">
          Warning: changing the rules starts a new rules version and removes any approval by the Chief Medical Officer.
        </p>
      </div>
    </ActionForm>
  );
}

const LABEL = { active: "Make live", read_only: "Make read only", archived: "Archive" } as const;

/** Status buttons. Which ones are offered follows the current status; the database has the final say. */
export function GroupStatusButtons({ id, slug, status, name }: { id: string; slug: string; status: "draft" | "active" | "read_only" | "archived"; name: string }) {
  const next: Array<"active" | "read_only" | "archived"> =
    status === "draft" ? ["active", "archived"] : status === "active" ? ["read_only", "archived"] : status === "read_only" ? ["active", "archived"] : [];
  if (next.length === 0) return <p className="text-sm text-charcoal-ink/70">Archived is final. Nothing more can be done with this group.</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {next.map((s) => (
        <ActionForm
          key={s}
          action={setGroupStatusAction}
          submitLabel={`${LABEL[s]}`}
          submitClassName={s === "archived" ? btnDanger : btnQuiet}
          className="space-y-2"
          confirm={s === "archived" ? `Archive "${name}"? Archived is final: the group can never be opened again.` : s === "active" ? `Make "${name}" live? Members will be able to see it.` : undefined}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="status" value={s} />
        </ActionForm>
      ))}
    </div>
  );
}
