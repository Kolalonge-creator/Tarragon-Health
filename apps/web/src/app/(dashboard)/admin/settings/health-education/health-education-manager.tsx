"use client";

import { useState } from "react";
import {
  useHealthEducationCatalogue,
  useSetContentActive,
  useSetContentDripWeek,
  useSetContentReviewDueAt,
  HEALTH_EDUCATION_CATEGORIES,
  type HealthEducationContent,
  type HealthEducationCategory,
} from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import Link from "next/link";

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

export function HealthEducationManager() {
  const { data: content, isLoading, isError } = useHealthEducationCatalogue();
  const setActive = useSetContentActive();
  const setDripWeek = useSetContentDripWeek();
  const setReviewDueAt = useSetContentReviewDueAt();
  const [categoryFilter, setCategoryFilter] = useState<HealthEducationCategory | "all">("all");

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
            <div className="mt-1 flex gap-3 text-xs">
              <Link href="/admin/settings/health-education/feedback" className="text-brand-green hover:underline">
                Feedback queue →
              </Link>
              <Link href="/admin/settings/health-education/analytics" className="text-brand-green hover:underline">
                Analytics →
              </Link>
            </div>
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
              <li key={item.id} className="space-y-2 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-charcoal-ink">
                      {item.title} <span className="text-charcoal-ink/40">v{item.version}</span>
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {categoryLabel(item.category)}
                      {` · ${conditionLabel(item.condition)}`}
                      {item.min_risk_level ? ` · risk ${item.min_risk_level}+` : ""}
                      {` · ${item.content_type}`}
                      {` · ${item.reading_level}`}
                      {item.clinician_reviewed ? " · clinician-reviewed" : " · not reviewed"}
                      {item.evidence_source ? ` · source: ${item.evidence_source}` : ""}
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
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-charcoal-ink/50">
                  <label htmlFor={`review_due_${item.id}`}>Next review due:</label>
                  <Input
                    id={`review_due_${item.id}`}
                    type="date"
                    className="h-7 w-36 text-xs"
                    value={item.review_due_at ? item.review_due_at.slice(0, 10) : ""}
                    onChange={(e) =>
                      setReviewDueAt.mutate({
                        id: item.id,
                        reviewDueAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                  {item.review_due_at && new Date(item.review_due_at) < new Date() && (
                    <Badge variant="amber">Review overdue</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
