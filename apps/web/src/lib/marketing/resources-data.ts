import { createClient } from "@supabase/supabase-js";
import {
  RESOURCE_ARTICLES as STATIC_FALLBACK,
  type ResourceArticle,
} from "@/app/(marketing)/_content/resources";

/**
 * DB-backed resource articles for the marketing site (founder ask: content
 * addable via admin, no deploy). Reads published marketing_resources rows
 * through a BARE anon supabase-js client — deliberately not
 * @/lib/supabase/server, so the marketing tree stays free of auth/platform
 * modules per the marketing-boundary rule; anon RLS only ever exposes
 * published rows. The retired static library remains as a build-time/outage
 * fallback so /resources can never render empty because of a network blip.
 */

type ResourceRow = {
  slug: string;
  title: string;
  description: string;
  category: string;
  read_minutes: number;
  related_href: string | null;
  related_label: string | null;
  sections: unknown;
};

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function toArticle(row: ResourceRow): ResourceArticle {
  const sections = Array.isArray(row.sections)
    ? (row.sections as { heading?: unknown; paragraphs?: unknown }[])
        .filter((s) => typeof s?.heading === "string" && Array.isArray(s?.paragraphs))
        .map((s) => ({
          heading: s.heading as string,
          paragraphs: (s.paragraphs as unknown[]).filter(
            (p): p is string => typeof p === "string"
          ),
        }))
    : [];
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category as ResourceArticle["category"],
    readMinutes: row.read_minutes,
    relatedHref: row.related_href ?? "/services",
    relatedLabel: row.related_label ?? "How Tarragon works",
    sections,
  };
}

export async function loadResourceArticles(): Promise<ResourceArticle[]> {
  const client = anonClient();
  if (!client) return STATIC_FALLBACK;
  const { data, error } = await client
    .from("marketing_resources")
    .select("slug, title, description, category, read_minutes, related_href, related_label, sections")
    .eq("is_published", true)
    .order("sort_order", { ascending: true });
  if (error || !data || data.length === 0) return STATIC_FALLBACK;
  return (data as ResourceRow[]).map(toArticle);
}

export async function loadResourceArticle(slug: string): Promise<ResourceArticle | null> {
  const client = anonClient();
  if (!client) return STATIC_FALLBACK.find((a) => a.slug === slug) ?? null;
  const { data, error } = await client
    .from("marketing_resources")
    .select("slug, title, description, category, read_minutes, related_href, related_label, sections")
    .eq("is_published", true)
    .eq("slug", slug)
    .maybeSingle();
  if (error) return STATIC_FALLBACK.find((a) => a.slug === slug) ?? null;
  if (!data) return null;
  return toArticle(data as ResourceRow);
}
