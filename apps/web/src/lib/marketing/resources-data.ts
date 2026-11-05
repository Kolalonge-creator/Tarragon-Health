import { marketingAnonClient as anonClient } from "./anon-client";
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
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  // Absent (undefined) when read with the legacy column list, see UNDEFINED_COLUMN.
  author_name?: string | null;
  next_review_at?: string | null;
  source_references?: unknown;
};

/**
 * References as stored (a JSON array of {label, url}), kept only when the
 * label is text and the URL is http(s): a reference is a link out of our site,
 * so nothing else (javascript:, data:, relative paths) is ever rendered.
 */
export function parseReferences(raw: unknown): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const { label, url } = r as { label?: unknown; url?: unknown };
    if (typeof label !== "string" || !label.trim() || typeof url !== "string") return [];
    try {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:" ? [{ label: label.trim(), url: u.toString() }] : [];
    } catch {
      return [];
    }
  });
}

const LEGACY_COLUMNS =
  "slug, title, description, category, read_minutes, related_href, related_label, sections, reviewed_by_name, reviewed_at, created_at, updated_at" as const;
const RESOURCE_ROW_COLUMNS = `${LEGACY_COLUMNS}, author_name, next_review_at, source_references` as const;

/**
 * Postgres "undefined column" (42703). If this code is live before the
 * provenance migration (20261105172209) has applied, retry with the columns
 * that existed before it rather than dropping to the static library.
 */
const UNDEFINED_COLUMN = "42703";

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
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    publishedAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name ?? null,
    nextReviewAt: row.next_review_at ?? null,
    references: parseReferences(row.source_references),
  };
}

/** A failed read must stay visible in server logs even though the page falls back to static copy (2026-10-29: an RLS error hid for weeks). */
function logReadFailure(what: string, error: { code?: string; message?: string }): void {
  console.error(`marketing_resources read failed (${what}); serving static fallback`, error.code ?? "", error.message ?? "");
}

export async function loadResourceArticles(): Promise<ResourceArticle[]> {
  const client = anonClient();
  if (!client) return STATIC_FALLBACK;
  const list = (columns: string) =>
    client.from("marketing_resources").select(columns).eq("is_published", true).order("sort_order", { ascending: true });
  let { data, error } = await list(RESOURCE_ROW_COLUMNS);
  if (error?.code === UNDEFINED_COLUMN) ({ data, error } = await list(LEGACY_COLUMNS));
  if (error) logReadFailure("list", error);
  if (error || !data || data.length === 0) return STATIC_FALLBACK;
  return (data as unknown as ResourceRow[]).map(toArticle);
}

export async function loadResourceArticle(slug: string): Promise<ResourceArticle | null> {
  const client = anonClient();
  if (!client) return STATIC_FALLBACK.find((a) => a.slug === slug) ?? null;
  const one = (columns: string) =>
    client.from("marketing_resources").select(columns).eq("is_published", true).eq("slug", slug).maybeSingle();
  let { data, error } = await one(RESOURCE_ROW_COLUMNS);
  if (error?.code === UNDEFINED_COLUMN) ({ data, error } = await one(LEGACY_COLUMNS));
  if (error) {
    logReadFailure(`slug ${slug}`, error);
    return STATIC_FALLBACK.find((a) => a.slug === slug) ?? null;
  }
  if (!data) return null;
  return toArticle(data as unknown as ResourceRow);
}
