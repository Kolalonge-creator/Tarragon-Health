"use client";

import { useState } from "react";
import {
  useCareMessageTemplates,
  useCreateCareMessageTemplate,
  useSetCareMessageTemplateActive,
} from "@/lib/queries/care-messages";
import { careMessageTemplateCategories, type CareMessageTemplateCategory } from "@/lib/validation/care-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TEMPLATE_CATEGORY_LABEL: Record<CareMessageTemplateCategory, string> = {
  result_communication: "Result communication",
  appointment_follow_up: "Appointment follow-up",
  medication_instructions: "Medication instructions",
  monitoring_reminder: "Monitoring reminder",
  general: "General",
};

/**
 * 77.7 — clinician-authored, editable reply templates. Any org staff member
 * can author one (not one of the three actions the Clinical Tier Ladder
 * restricts a Care Coordinator from); RLS enforces that at the row level
 * regardless of what this UI shows.
 */
export function CareMessageTemplateManager() {
  const { data: templates, isLoading } = useCareMessageTemplates();
  const create = useCreateCareMessageTemplate();
  const setActive = useSetCareMessageTemplateActive();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<CareMessageTemplateCategory>("general");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    create.mutate(
      { title, body, category },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          setCategory("general");
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Couldn't save template"),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-charcoal-ink">Reply templates</p>
        <p className="text-xs text-charcoal-ink/60">
          Starting text for a reply, always editable before you send.
        </p>
      </div>

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {!isLoading && (!templates || templates.length === 0) && (
        <p className="text-sm text-charcoal-ink/60">No templates yet.</p>
      )}
      {templates && templates.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10 rounded-lg border border-charcoal-ink/10">
          {templates.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-charcoal-ink">
                  {t.title}
                  <span className="ml-2 text-xs font-normal text-charcoal-ink/50">
                    {TEMPLATE_CATEGORY_LABEL[t.category]}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-charcoal-ink/60">{t.body}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={setActive.isPending}
                onClick={() => setActive.mutate({ id: t.id, isActive: false })}
              >
                Retire
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
        <Label htmlFor="template-title">New template</Label>
        <Input
          id="template-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Normal blood test result"
          maxLength={150}
        />
        <select
          aria-label="Template category"
          value={category}
          onChange={(e) => setCategory(e.target.value as CareMessageTemplateCategory)}
          className="h-9 w-full rounded-md border border-charcoal-ink/15 bg-white px-2 text-sm text-charcoal-ink"
        >
          {careMessageTemplateCategories.map((c) => (
            <option key={c} value={c}>
              {TEMPLATE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Your result looks normal. No action needed. We'll keep monitoring as usual."
          rows={3}
          maxLength={4000}
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={create.isPending || title.trim().length < 3 || body.trim().length === 0}
            onClick={submit}
          >
            {create.isPending ? "Saving…" : "Save template"}
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
