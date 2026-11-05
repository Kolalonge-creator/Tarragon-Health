import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type MarketingResource = Tables<"marketing_resources">;

export const marketingResourcesKey = ["marketing-resources", "admin"] as const;

export type ResourceSectionInput = { heading: string; paragraphs: string[] };

export type ResourceUpsertInput = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  readMinutes: number;
  relatedHref: string | null;
  relatedLabel: string | null;
  sections: ResourceSectionInput[];
  isPublished: boolean;
  sortOrder: number;
  // Library-level review credit (same discipline as
  // health_education_content.reviewed_by_name/reviewed_at) — both null
  // unless an admin genuinely records that a named clinician read this
  // specific article. Never auto-filled from the acting admin's own name.
  reviewedByName: string | null;
  reviewedAt: string | null;
  authorName: string | null;
  references: { label: string; url: string }[];
  nextReviewAt: string | null;
  publishAt: string | null;
};

/**
 * The database refuses to publish an article with no recorded clinical review
 * (errcode 23514, 'clinical_review_required'; website Phase 4). Turn that into
 * a sentence an editor can act on; any other error keeps its own message.
 */
export function resourceSaveErrorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  if (e?.message?.includes("clinical_review_required")) {
    return "This article cannot be published until a clinician has reviewed it. Add the reviewer's name, then publish. You can still save it as a draft.";
  }
  return e?.message || "Could not save.";
}

/**
 * References typed one per line as "Label | https://link". Lines without a
 * valid http(s) link are dropped (the article page drops them too).
 */
export function parseReferenceLines(text: string): { label: string; url: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const bar = line.lastIndexOf("|");
      if (bar === -1) return [];
      const label = line.slice(0, bar).trim();
      const url = line.slice(bar + 1).trim();
      try {
        const u = new URL(url);
        return label && (u.protocol === "https:" || u.protocol === "http:") ? [{ label, url: u.toString() }] : [];
      } catch {
        return [];
      }
    });
}

export function referencesToLines(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((r) => (r && typeof r === "object" ? `${(r as { label?: string }).label ?? ""} | ${(r as { url?: string }).url ?? ""}` : ""))
    .filter((l) => l.trim() !== "|")
    .join("\n");
}

/** Admin view of the whole library, drafts included (RLS: admins see all). */
export function useMarketingResources() {
  return useQuery({
    queryKey: marketingResourcesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("marketing_resources")
        .select("*")
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as MarketingResource[];
    },
  });
}

/** Create or update an article. The marketing site picks changes up within ~5 min (ISR). */
export function useUpsertMarketingResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResourceUpsertInput) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const row = {
        slug: input.slug,
        title: input.title,
        description: input.description,
        category: input.category,
        read_minutes: input.readMinutes,
        related_href: input.relatedHref,
        related_label: input.relatedLabel,
        sections: input.sections,
        is_published: input.isPublished,
        sort_order: input.sortOrder,
        updated_by: user?.id ?? null,
        reviewed_by_name: input.reviewedByName,
        reviewed_at: input.reviewedAt,
        author_name: input.authorName,
        source_references: input.references,
        next_review_at: input.nextReviewAt,
        publish_at: input.publishAt,
      };
      const { error } = input.id
        ? await supabase.from("marketing_resources").update(row).eq("id", input.id)
        : await supabase.from("marketing_resources").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketingResourcesKey });
    },
  });
}

export function useSetResourcePublished() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPublished }: { id: string; isPublished: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("marketing_resources")
        .update({ is_published: isPublished })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketingResourcesKey });
    },
  });
}

export function useDeleteMarketingResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("marketing_resources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketingResourcesKey });
    },
  });
}

/**
 * The editor's plain-text body format ↔ sections jsonb:
 *   "## Heading" starts a section; blank-line-separated blocks under it are
 *   paragraphs. Round-trips losslessly for content authored in the editor.
 */
export function parseSectionsFromText(text: string): ResourceSectionInput[] {
  const sections: ResourceSectionInput[] = [];
  let current: ResourceSectionInput | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), paragraphs: [] };
    } else if (line.trim() === "") {
      if (current && current.paragraphs[current.paragraphs.length - 1] !== "")
        current.paragraphs.push("");
    } else if (current) {
      const last = current.paragraphs.length - 1;
      if (last >= 0 && current.paragraphs[last] !== "") {
        current.paragraphs[last] = `${current.paragraphs[last]} ${line.trim()}`;
      } else {
        if (current.paragraphs[last] === "") current.paragraphs.pop();
        current.paragraphs.push(line.trim());
      }
    }
  }
  if (current) sections.push(current);
  return sections
    .map((s) => ({ ...s, paragraphs: s.paragraphs.filter((p) => p.trim() !== "") }))
    .filter((s) => s.heading && s.paragraphs.length > 0);
}

export function sectionsToText(sections: unknown): string {
  if (!Array.isArray(sections)) return "";
  return (sections as ResourceSectionInput[])
    .map((s) => `## ${s.heading}\n\n${(s.paragraphs ?? []).join("\n\n")}`)
    .join("\n\n");
}
