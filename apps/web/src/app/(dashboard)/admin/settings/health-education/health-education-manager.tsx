"use client";

import { useState, type FormEvent } from "react";
import {
  useHealthEducationCatalogue,
  useSetContentDripWeek,
  useCreateHealthEducationContent,
  useUpdateHealthEducationContent,
  useSetHealthEducationContentStatus,
  useContentStatusHistory,
  useContentTranslations,
  useUpsertTranslation,
  HEALTH_EDUCATION_CATEGORIES,
  HEALTH_EDUCATION_LANGUAGE_LABELS,
  type HealthEducationContent,
  type HealthEducationCategory,
  type HealthEducationContentStatus,
  type HealthEducationContentInput,
  type HealthEducationLanguage,
} from "@/lib/queries/health-education";
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
          <Label htmlFor="content_condition">Condition (optional — blank = everyone)</Label>
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
 * History & translations (§79.9/§79.11): the transition audit trail plus
 * per-language content — everything the inline status buttons above don't
 * cover. Collapsed by default so the catalogue list stays scannable.
 */
function HistoryAndTranslations({ item }: { item: HealthEducationContent }) {
  const { data: history } = useContentStatusHistory(item.id);
  const { data: translations } = useContentTranslations(item.id);
  const upsertTranslation = useUpsertTranslation();

  const [translationLang, setTranslationLang] = useState<HealthEducationLanguage>("pcm");
  const [translationTitle, setTranslationTitle] = useState("");
  const [translationBody, setTranslationBody] = useState("");

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

      <div className="space-y-2">
        <p className="text-xs font-medium text-charcoal-ink/60">
          Translations (§79.9) — human-authored only, never auto-generated
        </p>
        {translations && translations.length > 0 && (
          <ul className="text-xs text-charcoal-ink/60">
            {translations.map((t) => (
              <li key={t.id}>
                {HEALTH_EDUCATION_LANGUAGE_LABELS[t.language as HealthEducationLanguage]}: {t.title}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Translation language"
            className="h-8 w-40 text-xs"
            value={translationLang}
            onChange={(e) => setTranslationLang(e.target.value as HealthEducationLanguage)}
          >
            {Object.entries(HEALTH_EDUCATION_LANGUAGE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
          <Input
            className="h-8 w-56 text-xs"
            placeholder="Translated title"
            value={translationTitle}
            onChange={(e) => setTranslationTitle(e.target.value)}
          />
        </div>
        <textarea
          className="w-full rounded-md border border-charcoal-ink/15 p-2 text-xs"
          rows={3}
          placeholder="Translated body"
          value={translationBody}
          onChange={(e) => setTranslationBody(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!translationTitle.trim() || !translationBody.trim() || upsertTranslation.isPending}
          onClick={() =>
            upsertTranslation.mutate(
              {
                contentId: item.id,
                language: translationLang,
                title: translationTitle.trim(),
                body: translationBody.trim(),
              },
              {
                onSuccess: () => {
                  setTranslationTitle("");
                  setTranslationBody("");
                },
              }
            )
          }
        >
          Save translation
        </Button>
      </div>
    </div>
  );
}

function ContentRow({ item }: { item: HealthEducationContent }) {
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
        {nextStatuses.map((n) => (
          <Button
            key={n.status}
            size="sm"
            variant="outline"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: item.id, status: n.status })}
          >
            {n.label}
          </Button>
        ))}
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
      {managing && <HistoryAndTranslations item={item} />}
    </li>
  );
}

export function HealthEducationManager() {
  const { data: content, isLoading, isError } = useHealthEducationCatalogue();
  const createContent = useCreateHealthEducationContent();
  const [categoryFilter, setCategoryFilter] = useState<HealthEducationCategory | "all">("all");
  const [showCreate, setShowCreate] = useState(false);

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
                sent through clinical review, approved, and published — there is no direct
                publish shortcut.
              </CardDescription>
              <div className="mt-1 flex gap-3 text-xs">
                <Link href="/admin/settings/health-education/feedback" className="text-brand-green hover:underline">
                  Feedback queue →
                </Link>
                <Link href="/admin/settings/health-education/analytics" className="text-brand-green hover:underline">
                  Analytics →
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
                <ContentRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
