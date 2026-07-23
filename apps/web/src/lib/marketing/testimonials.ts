import { createClient } from "@supabase/supabase-js";

export interface PublishedTestimonial {
  id: string;
  display_name: string;
  quote: string;
}

/**
 * Marketing-side read of PUBLISHED patient testimonials only. Deliberately a
 * bare anon client (no platform/auth imports — marketing pages must stay
 * decoupled per CLAUDE.md); RLS exposes exactly the published rows to anon.
 * Fails soft to an empty list so the marketing page never breaks on it.
 */
export async function getPublishedTestimonials(limit = 6): Promise<PublishedTestimonial[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from("patient_testimonials")
      .select("id, display_name, quote")
      .eq("status", "published")
      .order("reviewed_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as PublishedTestimonial[];
  } catch {
    return [];
  }
}
