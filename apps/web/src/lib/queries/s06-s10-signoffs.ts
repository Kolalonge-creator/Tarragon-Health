import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import type { Database } from "@tarragon/shared";
import { guardListSchema, buildConfigRows, lagosToday, openRows, type ConfigRow } from "@/lib/go-live/model";
import { loadSignoffs, type RpcClient } from "@/lib/go-live/load";
import type { SignoffQueueItem } from "@/lib/queries/signoff-queue";
import {
  buildS06S10Rows,
  familyState,
  type VersionRow,
  attestItemKey,
  C4_CODE,
  HOME_BP_GUARD,
  PATTERN_CODE,
  PATTERN_GUARD,
  PROPOSED_VALUES_ITEM_KEY,
  S06_S10_CMO_PROPOSED_KEYS,
  S06_S10_FOUNDER_REVIEW,
  TRIAGE_DRAFT_ITEM_KEY,
  type RowFamilyState,
  type S06S10Facts,
  type S06S10Row,
} from "@/lib/clinical/s06-s10-signoff-model";

export type S06S10Snapshot = {
  rows: S06S10Row[];
  /** CMO-owned registry values still awaiting confirmation (the Chief Medical Officer can confirm these). */
  openProposed: ConfigRow[];
  /** Founder-owned values from the same build, for review. The CMO account cannot confirm them. */
  founderReview: Array<{ key: string; title: string; what: string; row: ConfigRow | null }>;
  /** Extra hub lines this snapshot contributes. */
  items: SignoffQueueItem[];
  failed: boolean;
  failedSources: string[];
};

const firstSentence = (text: string | null | undefined, max = 220): string => {
  const t = (text ?? "").trim();
  if (!t) return "";
  const cut = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return cut.length > max ? `${cut.slice(0, max - 1)}...` : cut;
};

const UNREADABLE: RowFamilyState = { status: "unreadable", panelKey: null, version: null };

async function readFamily(
  supabase: SupabaseClient<Database>,
  table: "home_bp_programme_signoffs" | "prn_limit_rules" | "my_health_config",
): Promise<RowFamilyState> {
  const { data, error } = await supabase.from(table).select("id, version, is_active, approved_by, approved_at");
  if (error || !data) return UNREADABLE;
  return familyState(data as VersionRow[], table);
}

async function readTriage(supabase: SupabaseClient<Database>): Promise<RowFamilyState> {
  // triage_rule_sets is not in the generated types yet (the page that signs it reads it the same way).
  const loose = supabase as unknown as {
    from(table: string): {
      select(columns: string): { eq(column: string, value: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
  const { data, error } = await loose.from("triage_rule_sets").select("id, version, status, note").eq("code", "bp_care_triage");
  if (error || !data) return UNREADABLE;
  const rows = data as Array<{ id: string; version: number; status: string; note: string | null }>;
  const approved = rows.filter((r) => r.status === "approved").sort((a, b) => b.version - a.version)[0] ?? null;
  const draft = rows.filter((r) => r.status === "draft" && r.version > (approved?.version ?? 0)).sort((a, b) => b.version - a.version)[0] ?? null;
  if (draft) return { status: "pending", panelKey: TRIAGE_DRAFT_ITEM_KEY, version: draft.version, approvedVersion: approved?.version ?? null, note: draft.note };
  if (approved) return { status: "signed", panelKey: null, version: approved.version };
  return { status: "missing", panelKey: null, version: null };
}

/**
 * The state of every S06 to S10 clinical item, read live, plus the hub lines for the ones that have no line of their own in the generic queue
 * (the triage draft, the two wording attestations, the registry values). Never throws: a read that fails is reported and the item shows as
 * unreadable, which is never an all-clear. Only call it for the Chief Medical Officer (the go-live functions refuse anyone else).
 */
export async function readS06S10Signoffs(supabase: SupabaseClient<Database>): Promise<S06S10Snapshot> {
  const failedSources: string[] = [];
  const client = supabase as unknown as RpcClient;

  const [homeBp, prn, myHealth, triage, guardsRes, signoffs] = await Promise.all([
    readFamily(supabase, "home_bp_programme_signoffs").catch(() => UNREADABLE),
    readFamily(supabase, "prn_limit_rules").catch(() => UNREADABLE),
    readFamily(supabase, "my_health_config").catch(() => UNREADABLE),
    readTriage(supabase).catch(() => UNREADABLE),
    Promise.resolve(client.rpc("go_live_guard_status")).catch(() => ({ data: null, error: { message: "failed" } })),
    loadSignoffs(client).catch(() => ({ ok: false as const })),
  ]);

  const guards = guardsRes.error ? null : guardListSchema.safeParse(guardsRes.data);
  const met = (guard: string, code: string): boolean | null => {
    if (!guards || !guards.success) return null;
    const g = guards.data.find((x) => x.key === guard);
    const c = g?.conditions.find((x) => x.code === code);
    return c ? c.met : null;
  };

  // Only the keys this build cares about: hashing the whole registry on every dashboard page would be wasted work.
  const wanted = new Set<string>([...S06_S10_CMO_PROPOSED_KEYS, ...S06_S10_FOUNDER_REVIEW.map((f) => f.key)]);
  const rowsConfig = signoffs.ok ? buildConfigRows(PROPOSED_CONFIG.filter((e) => wanted.has(e.key)), signoffs.data, lagosToday()) : null;
  const byKey = new Map((rowsConfig ?? []).map((r) => [r.key, r]));
  const done = (r: ConfigRow | undefined) => r !== undefined && (r.status === "signed" || r.status === "confirmed_in_registry");
  const proposedConfirmed: Record<string, boolean> | null = rowsConfig
    ? Object.fromEntries(S06_S10_CMO_PROPOSED_KEYS.map((k) => [k, done(byKey.get(k))]))
    : null;

  for (const [name, state] of [
    ["the home blood pressure programme", homeBp],
    ["the as-needed limits", prn],
    ["the My Health configuration", myHealth],
    ["the blood pressure triage rules", triage],
  ] as const) {
    if (state.status === "unreadable") failedSources.push(name);
  }
  const attestC4 = met(HOME_BP_GUARD, C4_CODE);
  const attestPattern = met(PATTERN_GUARD, PATTERN_CODE);
  if (attestC4 === null || attestPattern === null) failedSources.push("the go-live conditions");
  if (!signoffs.ok) failedSources.push("the proposed value sign-offs");

  const facts: S06S10Facts = {
    homeBp,
    prn,
    myHealth,
    triage,
    attestations: { c4CuffWording: attestC4, patternClinicianOnly: attestPattern },
    proposedConfirmed,
  };
  const rows = buildS06S10Rows(facts);

  const openProposed = rowsConfig ? openRows(rowsConfig.filter((r) => (S06_S10_CMO_PROPOSED_KEYS as readonly string[]).includes(r.key))) : [];
  const founderReview = S06_S10_FOUNDER_REVIEW.map((f) => ({ ...f, row: byKey.get(f.key) ?? null }));

  const items: SignoffQueueItem[] = [];
  if (triage.status === "pending") {
    items.push({
      key: TRIAGE_DRAFT_ITEM_KEY,
      title: `Blood pressure triage rules, version ${triage.version} (C5)`,
      detail: `Version ${triage.version} is a draft waiting for your signature.${triage.approvedVersion !== null && triage.approvedVersion !== undefined ? ` Version ${triage.approvedVersion} stays in force until you sign.` : ""}${firstSentence(triage.note) ? ` ${firstSentence(triage.note)}` : ""}`,
      href: "/clinician/triage-rules",
      severity: "draft_pending",
    });
  }
  if (facts.attestations.c4CuffWording === false) {
    items.push({
      key: attestItemKey(HOME_BP_GUARD, C4_CODE),
      title: "Home check patient wording (C4)",
      detail: "Record that you have read the cuff guidance and the band sentences the patient will see. Nothing is switched on by this.",
      href: "/clinician/go-live#home_bp_programme",
      severity: "draft_pending",
    });
  }
  if (facts.attestations.patternClinicianOnly === false) {
    items.push({
      key: attestItemKey(PATTERN_GUARD, PATTERN_CODE),
      title: "White-coat and masked flag is clinician-only (C3)",
      detail: "Record that no patient screen, notification or export shows the pattern flag.",
      href: "/clinician/go-live#bp_pattern_flag",
      severity: "draft_pending",
    });
  }
  if (openProposed.length > 0) {
    items.push({
      key: PROPOSED_VALUES_ITEM_KEY,
      title: "Proposed values from S06 to S10",
      detail: `${openProposed.length} value${openProposed.length === 1 ? "" : "s"} you own waiting to be confirmed: ${openProposed.map((r) => r.key).join(", ")}.`,
      href: "/clinician/go-live#proposed-values",
      severity: "draft_pending",
      count: openProposed.length,
    });
  }

  return { rows, openProposed, founderReview, items, failed: failedSources.length > 0, failedSources };
}

export const EMPTY_S06S10: S06S10Snapshot = { rows: [], openProposed: [], founderReview: [], items: [], failed: false, failedSources: [] };
