"use client";

import { useState } from "react";
import {
  useMarketingResources,
  useUpsertMarketingResource,
  useSetResourcePublished,
  useDeleteMarketingResource,
  parseSectionsFromText,
  sectionsToText,
  type MarketingResource,
} from "@/lib/queries/marketing-resources";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Draft = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  readMinutes: string;
  relatedHref: string;
  relatedLabel: string;
  body: string;
  sortOrder: string;
  reviewedByName: string;
  reviewedAt: string;
};

const EMPTY_DRAFT: Draft = {
  slug: "",
  title: "",
  description: "",
  category: "General",
  readMinutes: "4",
  relatedHref: "/services",
  relatedLabel: "How Tarragon works",
  body: "## First section heading\n\nFirst paragraph…",
  sortOrder: "100",
  reviewedByName: "",
  reviewedAt: "",
};

function Editor({
  draft,
  setDraft,
  onClose,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onClose: () => void;
}) {
  const upsert = useUpsertMarketingResource();
  const [error, setError] = useState<string | null>(null);

  const save = (publish: boolean) => {
    setError(null);
    const sections = parseSectionsFromText(draft.body);
    if (!draft.slug.match(/^[a-z0-9][a-z0-9-]*$/)) {
      setError("Slug must be lowercase letters, numbers and dashes (e.g. malaria-prevention)");
      return;
    }
    if (!draft.title.trim() || !draft.description.trim()) {
      setError("Title and description are required");
      return;
    }
    if (sections.length === 0) {
      setError('The body needs at least one "## Heading" followed by a paragraph');
      return;
    }
    upsert.mutate(
      {
        id: draft.id,
        slug: draft.slug,
        title: draft.title.trim(),
        description: draft.description.trim(),
        category: draft.category.trim() || "General",
        readMinutes: Math.min(60, Math.max(1, Number(draft.readMinutes) || 4)),
        relatedHref: draft.relatedHref.trim() || null,
        relatedLabel: draft.relatedLabel.trim() || null,
        sections,
        isPublished: publish,
        sortOrder: Number(draft.sortOrder) || 100,
        reviewedByName: draft.reviewedByName.trim() || null,
        // Setting a name without a date (or vice versa) would half-render
        // the byline, so both travel together — checking the box stamps
        // "now"; clearing the name clears the date too.
        reviewedAt: draft.reviewedByName.trim() ? draft.reviewedAt || new Date().toISOString() : null,
      },
      { onSuccess: onClose }
    );
  };

  return (
    <div className="space-y-3 rounded-xl border border-brand-green/25 bg-brand-green/[0.03] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="res-title">Title</Label>
          <Input
            id="res-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="res-slug">Slug (URL)</Label>
          <Input
            id="res-slug"
            value={draft.slug}
            disabled={!!draft.id}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            placeholder="e.g. malaria-prevention"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="res-desc">One-line description (shown on cards + search engines)</Label>
          <Input
            id="res-desc"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="res-cat">Category</Label>
          <Input
            id="res-cat"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            placeholder="e.g. Blood pressure"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="res-min">Read minutes</Label>
          <Input
            id="res-min"
            type="number"
            value={draft.readMinutes}
            onChange={(e) => setDraft({ ...draft, readMinutes: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="res-href">Related page link</Label>
          <Input
            id="res-href"
            value={draft.relatedHref}
            onChange={(e) => setDraft({ ...draft, relatedHref: e.target.value })}
            placeholder="/hypertension"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="res-label">Related page label</Label>
          <Input
            id="res-label"
            value={draft.relatedLabel}
            onChange={(e) => setDraft({ ...draft, relatedLabel: e.target.value })}
            placeholder="How Tarragon manages hypertension"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="res-reviewer">
            Medically reviewed by (leave blank until a real clinician has actually read this
            article — the byline and search-engine review signal only appear once this is set)
          </Label>
          <Input
            id="res-reviewer"
            value={draft.reviewedByName}
            onChange={(e) => setDraft({ ...draft, reviewedByName: e.target.value })}
            placeholder="e.g. Dr Jane Okafor, MDCN 12345"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="res-body">
          Body — start each section with &quot;## Heading&quot;, blank line between paragraphs
        </Label>
        <Textarea
          id="res-body"
          rows={14}
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          className="font-mono text-xs"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {upsert.isError && (
        <p className="text-sm text-red-600">
          {(upsert.error as Error).message || "Could not save."}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={upsert.isPending} onClick={() => save(true)}>
          Save &amp; publish
        </Button>
        <Button size="sm" variant="outline" disabled={upsert.isPending} onClick={() => save(false)}>
          Save as draft
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Admin editor for the marketing /resources hub — publish, edit, or draft
 * articles with no deploy (the site re-renders within ~5 minutes via ISR).
 * Editorial byline only: this surface makes no clinician-review claims, so
 * none can be fabricated through it.
 */
export function ResourcesManager() {
  const { data: resources, isLoading, isError } = useMarketingResources();
  const setPublished = useSetResourcePublished();
  const remove = useDeleteMarketingResource();
  const [draft, setDraft] = useState<Draft | null>(null);

  const startEdit = (r: MarketingResource) =>
    setDraft({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      category: r.category,
      readMinutes: String(r.read_minutes),
      relatedHref: r.related_href ?? "",
      relatedLabel: r.related_label ?? "",
      body: sectionsToText(r.sections),
      sortOrder: String(r.sort_order),
      reviewedByName: r.reviewed_by_name ?? "",
      reviewedAt: r.reviewed_at ?? "",
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resources library</CardTitle>
        <CardDescription>
          Articles on the public /resources hub. Published changes go live within ~5
          minutes — no deploy needed. Keep the voice: plain language, no fear, no
          miracle cures, no medical advice claims.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft ? (
          <Editor draft={draft} setDraft={setDraft} onClose={() => setDraft(null)} />
        ) : (
          <Button size="sm" onClick={() => setDraft(EMPTY_DRAFT)}>
            New article
          </Button>
        )}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the library.</p>}
        {resources && resources.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {resources.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-ink">{r.title}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    /{`resources/${r.slug}`} · {r.category} · {r.read_minutes} min
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={r.is_published ? "green" : "grey"}>
                    {r.is_published ? "Published" : "Draft"}
                  </Badge>
                  {r.reviewed_by_name && <Badge variant="green">Reviewed</Badge>}
                  <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setPublished.isPending}
                    onClick={() =>
                      setPublished.mutate({ id: r.id, isPublished: !r.is_published })
                    }
                  >
                    {r.is_published ? "Unpublish" : "Publish"}
                  </Button>
                  {!r.is_published && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(r.id)}
                    >
                      Delete
                    </Button>
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
