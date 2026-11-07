import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { myLabResultsSchema } from "@/lib/lab-results/structured";
import { formatPatientDate } from "@/lib/format-date";

/**
 * The record half of the patient search box (gap P23): results, medicines and messages, beside the pages the box already
 * matches in the browser. Every read goes through the caller's own session, so row-level security decides what comes back;
 * on top of that, while a supporter is acting for someone, a group is only searched when their grant covers its category
 * (medications, labs_results, messaging), so a group the grant does not cover is never even queried.
 *
 * Results come from public.my_lab_results(), the same released-only view the Labs page shows, so a result still held for
 * review is never found by its analyte name. That function reads the signed-in person's own record only, so a supporter
 * acting for someone gets no Results group (they cannot see results on the Labs page either).
 *
 * `failed` is set whenever any group could not be read: the box then says so rather than showing a shorter list (or
 * "Nothing matches") as if it were complete.
 */

type Client = SupabaseClient<Database>;

export type RecordHit = { label: string; href: string; group: "Results" | "Medicines" | "Messages"; hint: string };
export type RecordSearchResult = { results: RecordHit[]; failed: boolean };

export type RecordSearchScope = {
  /** The signed-in person. */
  userId: string;
  /** Whose record is open: the user, or the person they are acting for. */
  subjectId: string;
};

const PER_GROUP = 5;

/** Characters that mean something to PostgREST's filter syntax or to LIKE are dropped, not escaped. */
export function safeTerm(q: string): string {
  return q.replace(/[%_,()*\\"'`.:]/g, " ").replace(/\s+/g, " ").trim();
}

/** A short piece of a message around the first match, so the hint shows why it was found. */
export function snippetAround(text: string, needle: string, width = 70): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0 || flat.length <= width) return flat.length <= width ? flat : `${flat.slice(0, width)}…`;
  const start = Math.max(0, at - Math.floor((width - needle.length) / 2));
  const end = Math.min(flat.length, start + width);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

type Category = Database["public"]["Enums"]["care_access_category"];

/** The categories a supporter's grant covers, or null when the grant could not be read (treated as a failure). */
async function grantedCategories(supabase: Client, scope: RecordSearchScope): Promise<Set<Category> | null> {
  const { data, error } = await supabase
    .from("profile_access")
    .select("categories:profile_access_categories(category)")
    .eq("profile_id", scope.subjectId)
    .eq("grantee_user_id", scope.userId)
    .maybeSingle();
  if (error) return null;
  const rows = (data?.categories ?? []) as { category: Category }[];
  return new Set(rows.map((r) => r.category));
}

async function searchResults(supabase: Client, needle: string): Promise<RecordHit[] | null> {
  const { data, error } = await supabase.rpc("my_lab_results");
  if (error) return null;
  const parsed = myLabResultsSchema.safeParse(data ?? []);
  if (!parsed.success) return null;
  const hits: RecordHit[] = [];
  for (const r of parsed.data) {
    if (r.status !== "released") continue;
    const names = r.items.map((i) => i.analyte_code.replace(/_/g, " "));
    const panel = r.panel_code?.replace(/_/g, " ") ?? "";
    const matched = names.filter((n) => n.toLowerCase().includes(needle));
    if (matched.length === 0 && !panel.toLowerCase().includes(needle)) continue;
    hits.push({
      label: matched.length > 0 ? matched.slice(0, 3).join(", ") : panel,
      href: "/patient/labs",
      group: "Results",
      hint: `Result from ${formatPatientDate(r.received_at)}`,
    });
    if (hits.length >= PER_GROUP) break;
  }
  return hits;
}

async function searchMedicines(supabase: Client, subjectId: string, term: string): Promise<RecordHit[] | null> {
  const { data, error } = await supabase
    .from("medications")
    .select("id, drug_name, dose, frequency, is_active")
    .eq("patient_id", subjectId)
    .is("superseded_at", null)
    .ilike("drug_name", `%${term}%`)
    .order("is_active", { ascending: false })
    .limit(PER_GROUP);
  if (error) return null;
  return (data ?? []).map((m) => ({
    label: m.drug_name,
    href: "/patient/medications",
    group: "Medicines" as const,
    hint: [m.dose, m.frequency, m.is_active ? null : "Stopped"].filter(Boolean).join(" · "),
  }));
}

async function searchMessages(supabase: Client, subjectId: string, term: string): Promise<RecordHit[] | null> {
  const { data, error } = await supabase
    .from("care_messages")
    .select("id, body, created_at, thread:care_message_threads(subject)")
    .eq("patient_id", subjectId)
    .ilike("body", `%${term}%`)
    .order("created_at", { ascending: false })
    .limit(PER_GROUP);
  if (error) return null;
  return (data ?? []).map((m) => {
    const thread = (Array.isArray(m.thread) ? m.thread[0] : m.thread) as { subject: string } | null;
    return {
      label: thread?.subject?.trim() || "Message",
      href: "/patient/messages",
      group: "Messages" as const,
      hint: `${formatPatientDate(m.created_at)}: ${snippetAround(m.body, term)}`,
    };
  });
}

export async function searchPatientRecord(supabase: Client, scope: RecordSearchScope, query: string): Promise<RecordSearchResult> {
  const term = safeTerm(query);
  if (term.length < 2) return { results: [], failed: false };
  const needle = term.toLowerCase();
  const acting = scope.subjectId !== scope.userId;

  let allowed: Set<Category> | null = null;
  if (acting) {
    allowed = await grantedCategories(supabase, scope);
    if (!allowed) return { results: [], failed: true };
  }
  const covers = (c: Category) => !acting || (allowed?.has(c) ?? false);

  const [results, medicines, messages] = await Promise.all([
    // Results: own record only (see the header).
    !acting ? searchResults(supabase, needle) : Promise.resolve([] as RecordHit[]),
    covers("medications") ? searchMedicines(supabase, scope.subjectId, term) : Promise.resolve([] as RecordHit[]),
    covers("messaging") ? searchMessages(supabase, scope.subjectId, term) : Promise.resolve([] as RecordHit[]),
  ]);

  return {
    results: [...(results ?? []), ...(medicines ?? []), ...(messages ?? [])],
    failed: results === null || medicines === null || messages === null,
  };
}
