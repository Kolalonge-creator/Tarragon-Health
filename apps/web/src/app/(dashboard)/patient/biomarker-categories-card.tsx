"use client";

import Link from "next/link";
import { useBiomarkerCategories } from "@/lib/queries/biomarker-categories";
import type { BiomarkerCategoryView } from "@/lib/lab-reports/biomarker-categories";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

function CategoryTile({ category }: { category: BiomarkerCategoryView }) {
  const badge =
    category.status === "good"
      ? { variant: "green" as const, label: "Good" }
      : category.status === "needs_attention"
        ? { variant: "amber" as const, label: "Needs attention" }
        : null;

  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink">{category.label}</p>
        {badge ? (
          <Badge variant={badge.variant}>{badge.label}</Badge>
        ) : (
          <Badge variant="grey">Not reviewed yet</Badge>
        )}
      </div>
      {category.status === "needs_attention" && (
        <p className="mt-1.5 text-xs text-amber-700">
          {category.needsAttentionCount} of {category.reviewedCount} reviewed result
          {category.reviewedCount === 1 ? "" : "s"} need{category.reviewedCount === 1 ? "s" : ""}{" "}
          a closer look
        </p>
      )}
      {category.status === "good" && (
        <p className="mt-1.5 text-xs text-charcoal-ink/60">
          {category.reviewedCount} reviewed result{category.reviewedCount === 1 ? "" : "s"}, all
          within range
        </p>
      )}
      {category.status === null && (
        <p className="mt-1.5 text-xs text-charcoal-ink/50">No reviewed result on file yet.</p>
      )}
    </div>
  );
}

/**
 * Groups reviewed lab results into a small set of body-system categories
 * (lib/lab-reports/biomarker-categories.ts). Deliberately does not wire in
 * ResultExplainer: that component resolves a single risk_score/lab_analyte/
 * vitals row by subjectKey, and a category here can roll up several orders
 * at once — forcing that fit would mean changing the explainer's shared
 * snapshot-resolution logic for this one card. Links to the existing
 * per-order results list (already-shipped LabResults on /patient/labs)
 * instead, where each individual reviewed result has its own summary.
 */
export function BiomarkerCategoriesCard({ patientId }: { patientId: string }) {
  const { data: categories, isLoading } = useBiomarkerCategories(patientId);

  if (isLoading || !categories) return null;
  const anyReviewed = categories.some((c) => c.reviewedCount > 0);
  if (!anyReviewed) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your results, by area
        </CardTitle>
        <CardDescription>
          Reviewed lab results grouped by what they say about your body, not a longer list of
          numbers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((category) => (
            <CategoryTile key={category.key} category={category} />
          ))}
        </div>
        <p className="mt-4 text-sm">
          <Link href="/patient/labs" className="font-medium text-deep-forest hover:underline">
            See each result in full →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
