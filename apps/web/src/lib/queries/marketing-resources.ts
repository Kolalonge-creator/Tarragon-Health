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
};

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
