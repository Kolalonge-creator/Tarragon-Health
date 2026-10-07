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
import { getProposedConfig } from "@tarragon/shared";
import { useProgrammeLessonIds, useVerifiedClinicians } from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

const MAX_LESSON_MINUTES = Number(getProposedConfig("learning.max_lesson_minutes").value);

function ContentForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
  isCourseLesson = false,
}: {
  initial: HealthEducationContentInput;
  submitLabel: string;
  onSubmit: (input: HealthEducationContentInput) => void;
  pending: boolean;
  /** True when this item is a lesson in a programme: its length is then limited (spec 9.2), here and in the database. */
  isCourseLesson?: boolean;
}) {
  const [form, setForm] = useState<HealthEducationContentInput>(initial);
  const { data: clinicians } = useVerifiedClinicians();
  const minutesTooLong =
    isCourseLesson && (form.estimated_minutes == null || form.estimated_minutes < 1 || form.estimated_minutes > MAX_LESSON_MINUTES);

  function set<K extends keyof HealthEducationContentInput>(key: K, value: HealthEducationContentInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(form);
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
          <Label htmlFor="content_minutes">
            {isCourseLesson ? `Estimated minutes (course lesson: 1 to ${MAX_LESSON_MINUTES})` : "Estimated minutes (optional)"}
          </Label>
          <Input
            id="content_minutes"
            type="number"
            min={1}
            max={isCourseLesson ? MAX_LESSON_MINUTES : undefined}
            required={isCourseLesson}
            aria-invalid={minutesTooLong}
            value={form.estimated_minutes ?? ""}
            onChange={(e) => set("estimated_minutes", e.target.value ? Number(e.target.value) : null)}
          />
          {minutesTooLong && (
            <p className="text-xs text-red-600">A lesson in a course must take {MAX_LESSON_MINUTES} minutes or less.</p>
          )}
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
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="content_next_action">What can I do next? (required before publishing)</Label>
          <Input
            id="content_next_action"
            value={form.next_action ?? ""}
            maxLength={400}
            onChange={(e) => set("next_action", e.target.value || null)}
            placeholder="One concrete thing the person can do after reading this"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_next_kind">Link the next step to (optional)</Label>
          <Select
            id="content_next_kind"
            value={form.next_step_kind ?? ""}
            onChange={(e) => set("next_step_kind", (e.target.value || null) as HealthEducationContentInput["next_step_kind"])}
          >
            <option value="">Not set</option>
            <option value="care_plan_goal">A care plan goal</option>
            <option value="booking">A booking</option>
            <option value="lesson">Another lesson</option>
          </Select>
        </div>
        {form.next_step_kind === "lesson" && (
          <div className="space-y-1">
            <Label htmlFor="content_next_target">Code of the next lesson</Label>
            <Input
              id="content_next_target"
              className="font-mono text-xs"
              value={form.next_step_target_code ?? ""}
              onChange={(e) => set("next_step_target_code", e.target.value || null)}
              required
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="content_reviewer">Reviewed by (verified clinician)</Label>
          <Select
            id="content_reviewer"
            value={form.clinical_owner_id ?? ""}
            onChange={(e) => set("clinical_owner_id", e.target.value || null)}
          >
            <option value="">Not linked</option>
            {(clinicians ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="content_series">Series (optional)</Label>
          <Select id="content_series" value={form.series_tag ?? ""} onChange={(e) => set("series_tag", e.target.value || null)}>
            <option value="">None</option>
            <option value="myth_busting">Myth-busting</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={form.is_public ?? false}
            onChange={(e) => set("is_public", e.target.checked)}
          />
          Public: anyone with the link can read it (needs a complete clinician review record)
        </label>
      </div>
      <div className="space-y-1">
        <Label htmlFor="content_summary">Summary (optional)</Label>
        <Input id="content_summary" value={form.summary ?? ""} onChange={(e) => set("summary", e.target.value || null)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="content_body">Body</Label>
        <Textarea id="content_body" rows={6} value={form.body} onChange={(e) => set("body", e.target.value)} required />
      </div>
      <Button type="submit" size="sm" disabled={pending || minutesTooLong}>
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

function ContentRow({ item, isCourseLesson }: { item: HealthEducationContent; isCourseLesson: boolean }) {
  const setDripWeek = useSetContentDripWeek();
  const setStatus = useSetHealthEducationContentStatus();
  const updateContent = useUpdateHealthEducationContent();
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const badge = STATUS_BADGE[item.content_status];
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
      <div className="flex flex-wrap gap-2">
        {nextStatuses.map((n) => {
          const needsNextStep =
            n.status === "published" && item.content_status !== "review_due" && !item.next_action;
          return (
          <Button
            key={n.status}
            size="sm"
            variant="outline"
            title={needsNextStep ? "Add a \"what can I do next\" line first (Edit)" : undefined}
            disabled={setStatus.isPending || needsNextStep}
            onClick={() => setStatus.mutate({ id: item.id, status: n.status })}
          >
            {n.label}
          </Button>
          );
        })}
      </div>
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
              next_action: item.next_action,
              next_step_kind: item.next_step_kind as HealthEducationContentInput["next_step_kind"],
              next_step_target_code: item.next_step_target_code,
              series_tag: item.series_tag,
              is_public: item.is_public,
              clinical_owner_id: item.clinical_owner_id,
            }}
            isCourseLesson={isCourseLesson}
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
  const { data: lessonIdList } = useProgrammeLessonIds();
  const lessonIds = new Set(lessonIdList ?? []);

  const liveCount = content?.filter((c) => c.is_active).length ?? 0;
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
                <Link href="/admin/settings/health-education/aliases" className="text-brand-green hover:underline">
                  Search terms →
                </Link>
                <Link href="/admin/settings/health-education/creators" className="text-brand-green hover:underline">
                  Clinician creators →
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
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load the library.</p>}
          {filtered && filtered.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {filtered.map((item) => (
                <ContentRow key={item.id} item={item} isCourseLesson={lessonIds.has(item.id)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
