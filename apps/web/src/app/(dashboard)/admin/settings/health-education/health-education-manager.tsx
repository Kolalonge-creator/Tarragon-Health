"use client";

import { useState } from "react";
import {
  useHealthEducationCatalogue,
  useSetContentActive,
  useSetContentDripWeek,
  useSetContentStatus,
  useContentStatusHistory,
  useUpdateContentGovernance,
  useContentTranslations,
  useUpsertTranslation,
  HEALTH_EDUCATION_CATEGORIES,
  HEALTH_EDUCATION_STATUS_LABELS,
  HEALTH_EDUCATION_LEGAL_NEXT_STATUS,
  HEALTH_EDUCATION_LANGUAGE_LABELS,
  type HealthEducationContent,
  type HealthEducationCategory,
  type HealthEducationContentStatus,
  type HealthEducationLanguage,
} from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

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

function conditionLabel(condition: HealthEducationContent["condition"]): string {
  if (!condition) return "Everyone";
  return CONDITION_LABEL[condition] ?? condition;
}

function categoryLabel(category: HealthEducationCategory): string {
  return HEALTH_EDUCATION_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

function statusBadgeVariant(status: HealthEducationContentStatus): "green" | "blue" | "grey" {
  if (status === "published") return "green";
  if (status === "review_due" || status === "updated") return "blue";
  return "grey";
}

/**
 * Governance panel (§79.10/§79.11/§79.9): the full lifecycle (draft ->
 * clinical_review -> approved -> published -> review_due -> updated),
 * author/source/next-review fields, the transition audit trail, and
 * per-language translations — everything the Hide/Publish quick-toggle
 * above doesn't cover. Collapsed by default so the catalogue list stays
 * scannable; this is the "proper" workflow for content that wants a
 * documented review trail, alongside (not replacing) the quick toggle.
 */
function GovernancePanel({ item }: { item: HealthEducationContent }) {
  const setStatus = useSetContentStatus();
  const updateGovernance = useUpdateContentGovernance();
  const { data: history } = useContentStatusHistory(item.id);
  const { data: translations } = useContentTranslations(item.id);
  const upsertTranslation = useUpsertTranslation();

  const [authorName, setAuthorName] = useState(item.author_name ?? "");
  const [sourceReference, setSourceReference] = useState(item.source_reference ?? "");
  const [nextReviewDue, setNextReviewDue] = useState(item.next_review_due ?? "");
  const [translationLang, setTranslationLang] = useState<HealthEducationLanguage>("pcm");
  const [translationTitle, setTranslationTitle] = useState("");
  const [translationBody, setTranslationBody] = useState("");

  const legalNext = HEALTH_EDUCATION_LEGAL_NEXT_STATUS[item.content_status] ?? [];

  return (
    <div className="mt-3 space-y-4 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-charcoal-ink/60">Status:</span>
        <Badge variant={statusBadgeVariant(item.content_status)}>
          {HEALTH_EDUCATION_STATUS_LABELS[item.content_status]}
        </Badge>
        {legalNext.map((next) => (
          <Button
            key={next}
            size="sm"
            variant="outline"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: item.id, status: next })}
          >
            → {HEALTH_EDUCATION_STATUS_LABELS[next]}
          </Button>
        ))}
      </div>
      {setStatus.isError && (
        <p className="text-xs text-red-600">That transition isn&apos;t allowed from the current status.</p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs text-charcoal-ink/60">
          Author
          <Input
            className="mt-1 h-8 text-xs"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            onBlur={() => updateGovernance.mutate({ id: item.id, authorName: authorName || null })}
          />
        </label>
        <label className="text-xs text-charcoal-ink/60">
          Source / reference
          <Input
            className="mt-1 h-8 text-xs"
            value={sourceReference}
            onChange={(e) => setSourceReference(e.target.value)}
            onBlur={() =>
              updateGovernance.mutate({ id: item.id, sourceReference: sourceReference || null })
            }
          />
        </label>
        <label className="text-xs text-charcoal-ink/60">
          Next review due
          <Input
            className="mt-1 h-8 text-xs"
            type="date"
            value={nextReviewDue}
            onChange={(e) => setNextReviewDue(e.target.value)}
            onBlur={() =>
              updateGovernance.mutate({ id: item.id, nextReviewDue: nextReviewDue || null })
            }
          />
        </label>
      </div>

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

      <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
        <p className="text-xs font-medium text-charcoal-ink/60">
          Translations (§79.9) — human-authored only, never auto-generated
        </p>
        {translations && translations.length > 0 && (
          <ul className="text-xs text-charcoal-ink/60">
            {translations.map((t) => (
              <li key={t.id}>{HEALTH_EDUCATION_LANGUAGE_LABELS[t.language as HealthEducationLanguage]}: {t.title}</li>
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

export function HealthEducationManager() {
  const { data: content, isLoading, isError } = useHealthEducationCatalogue();
  const setActive = useSetContentActive();
  const setDripWeek = useSetContentDripWeek();
  const [categoryFilter, setCategoryFilter] = useState<HealthEducationCategory | "all">("all");
  const [managingId, setManagingId] = useState<string | null>(null);

  const liveCount = content?.filter((c) => c.is_active).length ?? 0;
  const filtered = content?.filter(
    (item) => categoryFilter === "all" || item.category === categoryFilter
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Articles &amp; videos</CardTitle>
            <CardDescription>
              {liveCount} of {content?.length ?? 0} items live across {HEALTH_EDUCATION_CATEGORIES.length}{" "}
              categories. Hiding an item removes it from every patient&apos;s feed and the browsable
              library immediately; their saved progress is kept.
            </CardDescription>
          </div>
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
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the library.</p>}
        {setActive.isError && (
          <p className="text-sm text-red-600">Could not update that item. Please try again.</p>
        )}
        {filtered && filtered.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {filtered.map((item) => (
              <li key={item.id} className="py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-charcoal-ink">{item.title}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {categoryLabel(item.category)}
                      {` · ${conditionLabel(item.condition)}`}
                      {item.min_risk_level ? ` · risk ${item.min_risk_level}+` : ""}
                      {` · ${item.content_type}`}
                      {item.clinician_reviewed ? " · clinician-reviewed" : " · not reviewed"}
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
                    <Badge variant={item.is_active ? "green" : "grey"}>
                      {item.is_active ? "Live" : "Hidden"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: item.id, isActive: !item.is_active })}
                    >
                      {item.is_active ? "Hide" : "Publish"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setManagingId(managingId === item.id ? null : item.id)}
                    >
                      {managingId === item.id ? "Close" : "Manage"}
                    </Button>
                  </div>
                </div>
                {managingId === item.id && <GovernancePanel item={item} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
