"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSaveTemplate, useSupportTemplates, useTemplateAction, type SupportTemplate } from "@/lib/queries/support-desk";

export const TEMPLATE_CATEGORY_LABEL: Record<string, string> = {
  acknowledgement: "Acknowledgement",
  more_information: "Asking for more information",
  assignment: "Assignment",
  investigation_update: "Investigation update",
  escalation: "Passed to another team",
  payment: "Payment question",
  membership: "Membership",
  resolution: "Resolution",
  closure: "Closure",
  feedback_request: "Feedback request",
  other: "Other",
};

const field = "w-full rounded-md border border-charcoal-ink/15 bg-white px-2 py-1.5 text-sm dark:border-night-ink/20 dark:bg-transparent";

function Editor({ me, initial, onDone }: { me: string; initial?: SupportTemplate; onDone: () => void }) {
  const save = useSaveTemplate();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [category, setCategory] = useState(initial?.category ?? "acknowledgement");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await save.mutateAsync({ id: initial?.id, title, body, category, createdBy: me });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save.");
        }
      }}
    >
      <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Title
        <input required minLength={3} maxLength={120} className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Use
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(TEMPLATE_CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Wording (plain and warm; never clinical advice)
        <textarea required minLength={10} maxLength={4000} rows={5} className={field} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {initial?.status === "approved" && <p className="text-xs text-charcoal-ink/60">Saving changed words returns this template to draft until it is approved again.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save as draft
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Reply templates (SUP-2, FD-5 rule): a lead writes and approves; agents see approved wording only. */
export function TemplatesManager({ me, isLead }: { me: string; isLead: boolean }) {
  const list = useSupportTemplates();
  const act = useTemplateAction();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = list.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reply templates</CardTitle>
        <CardDescription>
          {isLead
            ? "Starting points for replies. A new or edited template is a draft until you approve its exact words."
            : "Approved starting points for replies. Pick one in a ticket's reply box, then read and adjust before sending."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLead && editing !== "new" && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing("new")}>
            New template
          </Button>
        )}
        {editing === "new" && <Editor me={me} onDone={() => setEditing(null)} />}
        {list.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {list.isError && <p role="alert" className="text-sm text-red-700">Templates could not be loaded.</p>}
        {list.data && rows.length === 0 && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No templates yet.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {rows.map((t) =>
          editing === t.id ? (
            <Editor key={t.id} me={me} initial={t} onDone={() => setEditing(null)} />
          ) : (
            <div key={t.id} className="rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-charcoal-ink dark:text-night-ink">{t.title}</p>
                <div className="flex gap-2">
                  {t.category && <Badge variant="grey">{TEMPLATE_CATEGORY_LABEL[t.category] ?? t.category}</Badge>}
                  <Badge variant={t.status === "approved" ? "green" : "amber"}>{t.status === "approved" ? `Approved, v${t.version}` : `Draft, v${t.version}`}</Badge>
                </div>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t.body}</p>
              {isLead && (
                <div className="mt-2 flex gap-2">
                  {t.status === "draft" && (
                    <Button type="button" size="sm" disabled={act.isPending}
                      onClick={() => act.mutateAsync({ kind: "approve", id: t.id }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not approve."))}>
                      Approve these words
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(t.id)}>
                    Edit
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={act.isPending}
                    onClick={() => act.mutateAsync({ kind: "retire", id: t.id }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not retire."))}>
                    Retire
                  </Button>
                </div>
              )}
            </div>
          ),
        )}
      </CardContent>
    </Card>
  );
}
