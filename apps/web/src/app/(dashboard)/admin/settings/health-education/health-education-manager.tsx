"use client";

import { useState, type FormEvent } from "react";
import {
  useHealthEducationCatalogue,
  useSetContentDripWeek,
  useCreateHealthEducationContent,
  useUpdateHealthEducationContent,
  useSetHealthEducationContentStatus,
  useContentStatusHistory,
  HEALTH_EDUCATION_CATEGORIES,
  type HealthEducationContent,
  type HealthEducationCategory,
  type HealthEducationContentStatus,
  type HealthEducationContentInput,
} from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { flaggedButStillLive, isPastReviewDate } from "@/lib/health-education/review-flags";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLearningCreators } from "@/lib/queries/learning-centre";
import { parseKnowledgeCheck } from "@/lib/validation/health-education";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Blood pressure",
  diabetes: "Diabetes",
  obesity: "Weight",
  ckd: "Kidney health",
  cardiovascular: "Heart health",
  asthma: "Asthma",
  copd: "COPD",
  heart_failure: "Heart failure",
  other: "General",
};

const CONTENT_TYPES: HealthEducationContent["content_type"][] = [
  "article",
  "video",
  "audio",
  "infographic",
  "faq",
  "quiz",
  "interactive_module",
];

const RISK_LEVELS: NonNullable<HealthEducationContent["min_risk_level"]>[] = [
  "low",
  "moderate",
  "high",
  "very_high",
  "unknown",
];

const STATUS_BADGE: Record<HealthEducationContentStatus, { label: string; variant: "grey" | "amber" | "green" | "blue" }> = {
  draft: { label: "Draft", variant: "grey" },
  clinical_review: { label: "In clinical review", variant: "amber" },
  approved: { label: "Approved, not live", variant: "blue" },
  published: { label: "Live", variant: "green" },
  review_due: { label: "Live, review due", variant: "amber" },
  updated: { label: "Updated, needs re-review", variant: "amber" },
};

/** Mirrors the legal-transition state machine enforced by
 * public.set_health_education_content_status() — kept in sync manually since
 * the server is the real gate; this only decides which buttons to show. */
const NEXT_STATUSES: Record<HealthEducationContentStatus, { status: HealthEducationContentStatus; label: string }[]> = {
  draft: [{ status: "clinical_review", label: "Send for clinical review" }],
  clinical_review: [
    { status: "approved", label: "Approve" },
    { status: "draft", label: "Send back to draft" },
  ],
  approved: [
    { status: "published", label: "Publish" },
    { status: "clinical_review", label: "Back to review" },
  ],
  published: [
    { status: "review_due", label: "Flag for review" },
    { status: "updated", label: "Mark as updated" },
  ],
  review_due: [
    { status: "updated", label: "Mark as updated" },
    { status: "published", label: "Re-publish as-is" },
  ],
  updated: [{ status: "clinical_review", label: "Send for clinical review" }],
};

function conditionLabel(condition: HealthEducationContent["condition"]): string {
  if (!condition) return "Everyone";
  return CONDITION_LABEL[condition] ?? condition;
}

function categoryLabel(category: HealthEducationCategory): string {
  return HEALTH_EDUCATION_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

function emptyForm(): HealthEducationContentInput {
  return {
    code: "",
    title: "",
    body: "",
    category: "getting_started",
    content_type: "article",
  };
}

function ContentForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
}: {
  initial: HealthEducationContentInput;
  submitLabel: string;
  onSubmit: (input: HealthEducationContentInput) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState<HealthEducationContentInput>(initial);
  const { data: creators } = useLearningCreators();
  const firstCheck = parseKnowledgeCheck(initial.knowledge_check)?.[0];
  const [checkQuestion, setCheckQuestion] = useState(firstCheck?.question ?? "");
  const [checkOptions, setCheckOptions] = useState(firstCheck?.options.join("\n") ?? "");
  const [checkAnswer, setCheckAnswer] = useState(firstCheck ? String(firstCheck.answer_index + 1) : "1");

  function set<K extends keyof HealthEducationContentInput>(key: K, value: HealthEducationContentInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const options = checkOptions.split("\n").map((o) => o.trim()).filter(Boolean);
        const withCheck: HealthEducationContentInput = form.is_micro_lesson && checkQuestion.trim() && options.length >= 2
          ? { ...form, knowledge_check: [{ question: checkQuestion.trim(), options, answer_index: Math.max(0, Math.min(options.length - 1, Number(checkAnswer) - 1)) }] }
          : { ...form, knowledge_check: undefined };
        onSubmit(withCheck);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="content_code">Code (unique, stable)</Label>
          <Input
            id="content_code"
            value={form.code}
            onChange={(e) => set("code", e.target.value)}
            className="font-mono text-xs"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_title">Title</Label>
          <Input id="content_title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_category">Category</Label>
          <Select
            id="content_category"
            value={form.category}
            onChange={(e) => set("category", e.target.value as HealthEducationCategory)}
          >
            {HEALTH_EDUCATION_CATEGORIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_type">Type</Label>
          <Select
            id="content_type"
            value={form.content_type}
            onChange={(e) => set("content_type", e.target.value as HealthEducationContentInput["content_type"])}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_condition">Condition (optional, blank = everyone)</Label>
          <Select
            id="content_condition"
            value={form.condition ?? ""}
            onChange={(e) => set("condition", (e.target.value || null) as HealthEducationContentInput["condition"])}
          >
            <option value="">Everyone</option>
            {Object.keys(CONDITION_LABEL).map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_min_risk">Minimum risk level (optional)</Label>
          <Select
            id="content_min_risk"
            value={form.min_risk_level ?? ""}
            onChange={(e) =>
              set("min_risk_level", (e.target.value || null) as HealthEducationContentInput["min_risk_level"])
            }
          >
            <option value="">Any risk level</option>
            {RISK_LEVELS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_minutes">Estimated minutes (optional)</Label>
          <Input
            id="content_minutes"
            type="number"
            min={1}
            value={form.estimated_minutes ?? ""}
            onChange={(e) => set("estimated_minutes", e.target.value ? Number(e.target.value) : null)}
          />
        </div>
        {(form.content_type === "video" || form.content_type === "interactive_module") && (
          <div className="space-y-1">
            <Label htmlFor="content_video">Video URL</Label>
            <Input id="content_video" value={form.video_url ?? ""} onChange={(e) => set("video_url", e.target.value || null)} />
          </div>
        )}
        {form.content_type === "audio" && (
          <div className="space-y-1">
            <Label htmlFor="content_audio">Audio URL</Label>
            <Input id="content_audio" value={form.audio_url ?? ""} onChange={(e) => set("audio_url", e.target.value || null)} />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="content_author">Author (optional)</Label>
          <Input id="content_author" value={form.author_name ?? ""} onChange={(e) => set("author_name", e.target.value || null)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_source">Source / reference (optional)</Label>
          <Input
            id="content_source"
            value={form.source_reference ?? ""}
            onChange={(e) => set("source_reference", e.target.value || null)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_review_due">Next review due (optional)</Label>
          <Input
            id="content_review_due"
            type="date"
            value={form.next_review_due ?? ""}
            onChange={(e) => set("next_review_due", e.target.value || null)}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="content_reviewer">Clinical reviewer (name, required to publish)</Label>
          <Input id="content_reviewer" value={form.reviewed_by_name ?? ""} onChange={(e) => set("reviewed_by_name", e.target.value || null)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_clinical_author">Clinical author (name)</Label>
          <Input id="content_clinical_author" value={form.clinical_author_name ?? ""} onChange={(e) => set("clinical_author_name", e.target.value || null)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="content_self_care">What can I do next? Self-care step (required to publish)</Label>
          <Input id="content_self_care" value={form.self_care_action ?? ""} onChange={(e) => set("self_care_action", e.target.value || null)} />
          <p className="text-xs text-charcoal-ink/60">Asking the care team, booking and the urgent-help box are added by the template and cannot be edited here.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_audio_clip">Audio clip id (S32 manifest, optional)</Label>
          <Input id="content_audio_clip" className="font-mono text-xs" placeholder="LSN-001" value={form.audio_clip_id ?? ""} onChange={(e) => set("audio_clip_id", e.target.value || null)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_creator">Credited creator (verified clinicians only)</Label>
          <Select id="content_creator" value={form.creator_id ?? ""} onChange={(e) => set("creator_id", e.target.value || null)}>
            <option value="">None</option>
            {(creators ?? []).filter((c) => c.status === "verified").map((c) => (
              <option key={c.id} value={c.id}>{c.display_name}</option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.share_enabled ?? true} onChange={(e) => set("share_enabled", e.target.checked)} />
          Patients may share this article by link
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_micro_lesson ?? false} onChange={(e) => set("is_micro_lesson", e.target.checked)} />
          Weekly micro-lesson (under five minutes, one action, one check question)
        </label>
      </div>
      {form.is_micro_lesson && (
        <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
          <div className="space-y-1">
            <Label htmlFor="content_lesson_action">The one action</Label>
            <Input id="content_lesson_action" value={form.lesson_action ?? ""} onChange={(e) => set("lesson_action", e.target.value || null)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="content_check_q">The one check question</Label>
            <Input id="content_check_q" value={checkQuestion} onChange={(e) => setCheckQuestion(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="content_check_opts">Answer options (one per line, at least two)</Label>
            <Textarea id="content_check_opts" rows={3} value={checkOptions} onChange={(e) => setCheckOptions(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="content_check_ans">Correct option number</Label>
            <Input id="content_check_ans" type="number" min={1} value={checkAnswer} onChange={(e) => setCheckAnswer(e.target.value)} />
          </div>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="content_summary">Summary (optional)</Label>
        <Input id="content_summary" value={form.summary ?? ""} onChange={(e) => set("summary", e.target.value || null)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="content_body">Body</Label>
        <Textarea id="content_body" rows={6} value={form.body} onChange={(e) => set("body", e.target.value)} required />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

/**
 * History (§79.11): the transition audit trail the inline status buttons above
 * don't show. Collapsed by default so the catalogue list stays scannable.
 */
function ContentHistory({ item }: { item: HealthEducationContent }) {
  const { data: history } = useContentStatusHistory(item.id);

  return (
    <div className="space-y-4 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
      {history && history.length > 0 && (
        <div>
          <p className="text-xs font-medium text-charcoal-ink/60">History</p>
          <ul className="mt-1 space-y-0.5 text-xs text-charcoal-ink/50">
            {history.slice(0, 5).map((h) => (
              <li key={h.id}>
                {h.from_status ?? "—"} → {h.to_status} · {new Date(h.created_at).toLocaleDateString()}
                {h.note ? ` · ${h.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ContentRow({ item }: { item: HealthEducationContent }) {
  const setDripWeek = useSetContentDripWeek();
  const setStatus = useSetHealthEducationContentStatus();
  const updateContent = useUpdateHealthEducationContent();
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const hidden = isPastReviewDate(item) && (item.content_status === "published" || item.content_status === "review_due");
  const badge = hidden
    ? { label: "Hidden, review date passed", variant: "amber" as const }
    : STATUS_BADGE[item.content_status];
  const nextStatuses = NEXT_STATUSES[item.content_status] ?? [];

  return (
    <li className="space-y-2 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-charcoal-ink">{item.title}</p>
          <p className="text-xs text-charcoal-ink/60">
            {categoryLabel(item.category)}
            {` · ${conditionLabel(item.condition)}`}
            {item.min_risk_level ? ` · risk ${item.min_risk_level}+` : ""}
            {` · ${item.content_type}`}
            {item.clinician_reviewed ? " · clinician-reviewed" : " · not yet reviewed"}
            {item.author_name ? ` · by ${item.author_name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label={`Curriculum week for ${item.title}`}
            className="h-8 w-28 text-xs"
            value={item.drip_week === null ? "" : String(item.drip_week)}
            onChange={(e) =>
              setDripWeek.mutate({
                id: item.id,
                dripWeek: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          >
            <option value="">Always on</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((week) => (
              <option key={week} value={week}>
                Week {week}
              </option>
            ))}
          </Select>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setManaging((v) => !v)}>
            {managing ? "Close" : "History"}
          </Button>
        </div>
      </div>
      {item.is_placeholder && (
        <p className="text-xs font-medium text-amber-800">
          Draft placeholder, needs a clinical author. It cannot be published until a clinical author is named and the placeholder text is replaced.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {nextStatuses.map((n) => (
          <Button
            key={n.status}
            size="sm"
            variant="outline"
            disabled={setStatus.isPending || (item.is_placeholder && n.status !== "draft")}
            onClick={() => setStatus.mutate({ id: item.id, status: n.status })}
          >
            {n.label}
          </Button>
        ))}
      </div>
      {item.content_status === "review_due" && item.review_flag_reason && (
        <p className="text-xs text-amber-700">{item.review_flag_reason}</p>
      )}
      {setStatus.isError && <p className="text-xs text-red-600">{(setStatus.error as Error).message}</p>}
      {editing && (
        <div className="rounded-md bg-charcoal-ink/5 p-3">
          <ContentForm
            initial={{
              code: item.code,
              title: item.title,
              summary: item.summary,
              body: item.body,
              category: item.category,
              content_type: item.content_type,
              condition: item.condition,
              min_risk_level: item.min_risk_level,
              estimated_minutes: item.estimated_minutes,
              video_url: item.video_url,
              audio_url: item.audio_url,
              author_name: item.author_name,
              source_reference: item.source_reference,
              next_review_due: item.next_review_due,
              reviewed_by_name: item.reviewed_by_name,
              clinical_author_name: item.clinical_author_name,
              evidence_source: item.evidence_source,
              self_care_action: item.self_care_action,
              audio_clip_id: item.audio_clip_id,
              is_micro_lesson: item.is_micro_lesson,
              lesson_action: item.lesson_action,
              share_enabled: item.share_enabled,
              creator_id: item.creator_id,
              knowledge_check: item.knowledge_check,
            }}
            submitLabel="Save changes"
            pending={updateContent.isPending}
            onSubmit={(input) => {
              updateContent.mutate({ id: item.id, ...input }, { onSuccess: () => setEditing(false) });
            }}
          />
          {updateContent.isError && (
            <p className="mt-2 text-xs text-red-600">{(updateContent.error as Error).message}</p>
          )}
        </div>
      )}
      {managing && <ContentHistory item={item} />}
    </li>
  );
}

export function HealthEducationManager() {
  const { data: content, isLoading, isError } = useHealthEducationCatalogue();
  const createContent = useCreateHealthEducationContent();
  const [categoryFilter, setCategoryFilter] = useState<HealthEducationCategory | "all">("all");
  const [showCreate, setShowCreate] = useState(false);

  const liveCount = content?.filter((c) => c.is_active && !isPastReviewDate(c)).length ?? 0;
  const flagged = content ? flaggedButStillLive(content) : [];
  const filtered = content?.filter(
    (item) => categoryFilter === "all" || item.category === categoryFilter
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Articles &amp; videos</CardTitle>
              <CardDescription>
                {liveCount} of {content?.length ?? 0} items live across {HEALTH_EDUCATION_CATEGORIES.length}{" "}
                categories. New content starts as a draft and only reaches patients once it&apos;s been
                sent through clinical review, approved, and published. There is no direct
                publish shortcut.
              </CardDescription>
              <div className="mt-1 flex gap-3 text-xs">
                <Link href="/admin/settings/health-education/feedback" className="text-brand-green hover:underline">
                  Feedback queue →
                </Link>
                <Link href="/admin/settings/health-education/analytics" className="text-brand-green hover:underline">
                  Analytics →
                </Link>
                <Link href="/admin/settings/health-education/creators" className="text-brand-green hover:underline">
                  Creators →
                </Link>
                <Link href="/admin/settings/health-education/readiness" className="text-brand-green hover:underline">
                  Content readiness →
                </Link>
                <Link href="/admin/settings/health-education/search-gaps" className="text-brand-green hover:underline">
                  Searches with no result →
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select
                aria-label="Filter by category"
                className="h-9 w-56 text-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as HealthEducationCategory | "all")}
              >
                <option value="all">All categories</option>
                {HEALTH_EDUCATION_CATEGORIES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? "Cancel" : "New content"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showCreate && (
            <div className="rounded-md bg-charcoal-ink/5 p-3">
              <ContentForm
                initial={emptyForm()}
                submitLabel="Create draft"
                pending={createContent.isPending}
                onSubmit={(input) =>
                  createContent.mutate(input, { onSuccess: () => setShowCreate(false) })
                }
              />
              {createContent.isError && (
                <p className="mt-2 text-xs text-red-600">{(createContent.error as Error).message}</p>
              )}
            </div>
          )}
          {flagged.length > 0 && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                {flagged.length} {flagged.length === 1 ? "item is" : "items are"} flagged for re-review and still live to patients.
              </p>
              <p className="mt-1 text-xs">
                A clinical protocol changed version, so content on that condition needs a fresh clinical look. Nothing
                was taken offline: each item keeps being shown until its own review date. Open an item to re-review it.
              </p>
              <ul className="mt-2 list-disc pl-5 text-xs">
                {flagged.slice(0, 10).map((i) => (
                  <li key={i.id}>
                    {i.title}
                    {i.next_review_due ? ` (live until ${i.next_review_due})` : " (no review date set)"}
                  </li>
                ))}
                {flagged.length > 10 && <li>and {flagged.length - 10} more</li>}
              </ul>
            </div>
          )}
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load the library.</p>}
          {filtered && filtered.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {filtered.map((item) => (
                <ContentRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
