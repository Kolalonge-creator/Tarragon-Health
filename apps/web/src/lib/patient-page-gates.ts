import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  PATIENT_PAGE_GATES,
  hiddenWebHrefs,
  type PatientGateAnswer,
  type PatientGateAnswers,
  type PatientGateId,
  type PatientPageGate,
} from "@tarragon/shared";
import type { AdminSearchEntry } from "@/lib/admin-search";
import type { NavSection } from "@/lib/navigation";
import { parseMembership } from "@/lib/commerce/model";

/**
 * Hides a patient page from the menu, from search and from hubs while its go-live guard is off (see the shared list in
 * `@tarragon/shared` patient-page-gates). It reads the SAME guard the page itself reads (`go_live_guard_is_open`), switches nothing on, and
 * leaves the page alone: someone who reaches the address directly still sees the page's own "not open yet" notice.
 *
 * Only the gates whose address actually appears in the menu being drawn are read, so a menu with none of them costs nothing.
 */

type Client = SupabaseClient<Database>;

async function guardOpen(supabase: Client, key: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: key });
    return error || typeof data !== "boolean" ? null : data;
  } catch {
    return null;
  }
}

/** Whether the person already holds something on a holdable page. `null` means the read failed (the page then stays). */
async function holds(supabase: Client, id: PatientGateId, patientId: string): Promise<boolean | null> {
  try {
    if (id === "appointments") {
      const { count, error } = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("patient_id", patientId);
      return error || count === null ? null : count > 0;
    }
    if (id === "recordsRequests") {
      const { data, error } = await supabase.rpc("my_records_requests");
      return error || !Array.isArray(data) ? null : data.length > 0;
    }
    if (id === "membership") {
      const { data, error } = await supabase.rpc("my_membership");
      if (error) return null;
      const m = parseMembership(data);
      if (m.is_member || m.ends_at !== null) return true;
      const { data: orders, error: ordersError } = await supabase.rpc("my_orders");
      return ordersError || !Array.isArray(orders) ? null : orders.length > 0;
    }
    return null;
  } catch {
    return null;
  }
}

async function readGate(supabase: Client, gate: PatientPageGate, patientId: string): Promise<PatientGateAnswer> {
  const [guard, held] = await Promise.all([guardOpen(supabase, gate.guard), gate.holdable ? holds(supabase, gate.id, patientId) : Promise.resolve(null)]);
  return { guardOpen: guard, holds: held };
}

/** The addresses to leave out of a patient's menu and search, among the `candidates` that are actually drawn. */
export async function readHiddenPatientHrefs(supabase: Client, patientId: string, candidates: readonly string[]): Promise<Set<string>> {
  const wanted = PATIENT_PAGE_GATES.filter((g) => g.webHrefs.some((h) => candidates.includes(h)));
  if (wanted.length === 0) return new Set();
  const answers: PatientGateAnswers = {};
  const read = await Promise.all(wanted.map(async (g) => [g.id, await readGate(supabase, g, patientId)] as const));
  for (const [id, answer] of read) answers[id] = answer;
  return hiddenWebHrefs(answers);
}

/** Every address in a menu, including the ones inside a section. */
export function navHrefs(sections: readonly NavSection[]): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.href));
}

/** The menu without the hidden pages. A section left with no links is dropped. */
export function withoutHiddenNav(sections: NavSection[], hidden: ReadonlySet<string>): NavSection[] {
  if (hidden.size === 0) return sections;
  return sections.map((s) => ({ ...s, items: s.items.filter((i) => !hidden.has(i.href)) })).filter((s) => s.items.length > 0);
}

/** Search entries without the hidden pages, so a search can never lead to a "not open yet" notice. */
export function withoutHiddenSearch(entries: AdminSearchEntry[], hidden: ReadonlySet<string>): AdminSearchEntry[] {
  return hidden.size === 0 ? entries : entries.filter((e) => !hidden.has(e.href));
}
