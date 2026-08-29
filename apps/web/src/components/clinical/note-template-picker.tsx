"use client";

import { useState } from "react";
import {
  useNoteTemplates,
  useCreateNoteTemplate,
  useDeleteNoteTemplate,
} from "@/lib/queries/note-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Care Team / Provider Workspace §5.8 — a reusable text picker for any
 * free-text clinical note field. Insert-only: it hands the selected
 * template's body to `onInsert` and lets the caller decide how to combine it
 * with whatever the clinician has already typed (append vs. replace), since
 * that varies by field (a single-line note vs. a multi-paragraph one).
 */
export function NoteTemplatePicker({
  organisationId,
  onInsert,
}: {
  organisationId: string;
  onInsert: (body: string) => void;
}) {
  const { data: templates } = useNoteTemplates(organisationId);
  const createTemplate = useCreateNoteTemplate();
  const deleteTemplate = useDeleteNoteTemplate();

  const [selectedId, setSelectedId] = useState("");
  const [managing, setManaging] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  const list = templates ?? [];
  const selected = list.find((t) => t.id === selectedId);

  return (
    <div className="space-y-1.5 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="h-8 max-w-56 flex-1 rounded-md border border-charcoal-ink/15 bg-white px-2 text-xs text-charcoal-ink"
        >
          <option value="">Insert a template…</option>
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs"
          disabled={!selected}
          onClick={() => {
            if (selected) onInsert(selected.body);
          }}
        >
          Insert
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-charcoal-ink/60"
          onClick={() => setManaging((v) => !v)}
        >
          {managing ? "Close" : "Manage"}
        </Button>
      </div>

      {managing && (
        <div className="space-y-2 border-t border-charcoal-ink/10 pt-2">
          {list.length > 0 && (
            <ul className="space-y-1">
              {list.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-charcoal-ink/70">{t.title}</span>
                  <button
                    type="button"
                    className="shrink-0 text-charcoal-ink/40 hover:text-red-600"
                    onClick={() => deleteTemplate.mutate({ id: t.id, organisationId })}
                    aria-label={`Delete template ${t.title}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="new_template_title" className="text-xs">
              New template title
            </Label>
            <Input
              id="new_template_title"
              className="h-8 text-xs"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="e.g. No answer, left voicemail"
            />
            <Textarea
              value={newBody}
              onChange={(event) => setNewBody(event.target.value)}
              placeholder="Template text…"
              rows={2}
              className="text-xs"
            />
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={createTemplate.isPending || !newTitle.trim() || !newBody.trim()}
              onClick={() =>
                createTemplate.mutate(
                  { organisationId, title: newTitle.trim(), body: newBody.trim() },
                  {
                    onSuccess: () => {
                      setNewTitle("");
                      setNewBody("");
                    },
                  },
                )
              }
            >
              {createTemplate.isPending ? "Saving…" : "Save template"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
