import { redirect } from "next/navigation";
import { z, type ZodType } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { guardListSchema } from "@/lib/go-live/model";
import {
  adminGroupSchema, adminTopicsSchema, adminStaffSchema, ruleSetsSchema, rulesSchema, pinnedAdminSchema, overviewSchema,
  qualitySummarySchema, promptsAdminSchema,
} from "@/lib/community/model";
import { getRpcClient } from "./rpc";

export type Loaded<T> = { ok: true; data: T } | { ok: false };

/** Same gate as the neighbouring admin pages (the proxy already limits /admin; the database re-checks on every call). */
export async function requireAdmin(): Promise<void> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
}

async function load<T>(fn: string, schema: ZodType<T>, args?: Record<string, unknown>): Promise<Loaded<T>> {
  const client = await getRpcClient();
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false };
  const parsed = schema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

export const loadOverview = () => load("community_admin_overview", overviewSchema);
/**
 * The groups, plus `member_cap` when the function returns it. community_admin_groups does not return it yet, so it is optional here
 * and the page says the current limit is not shown rather than guessing.
 */
const adminGroupsWithCapSchema = z.object({ groups: z.array(adminGroupSchema.extend({ member_cap: z.number().int().nullable().optional() })) });
export const loadGroups = () => load("community_admin_groups", adminGroupsWithCapSchema);
export const loadTopics = () => load("community_admin_topics", adminTopicsSchema);
export const loadStaff = () => load("community_admin_staff", adminStaffSchema);
export const loadRuleSets = () => load("community_admin_rule_sets", ruleSetsSchema);
export const loadRules = (version: number) => load("community_admin_rules", rulesSchema, { p_version: version });
export const loadQualitySummary = () => load("community_quality_summary", qualitySummarySchema);
export const loadPrompts = (groupId: string) => load("community_admin_prompts", promptsAdminSchema, { p_group_id: groupId });
export const loadPinned = (groupId: string) => load("community_admin_pinned", pinnedAdminSchema, { p_group_id: groupId });

/** Whether the `community` go-live guard is on. Read only: only the Chief Medical Officer switches it, on the go-live page. */
export async function loadCommunitySwitch(): Promise<Loaded<{ isOn: boolean }>> {
  const client = await getRpcClient();
  const { data, error } = await client.rpc("go_live_guard_status");
  if (error) return { ok: false };
  const parsed = guardListSchema.safeParse(data);
  if (!parsed.success) return { ok: false };
  const g = parsed.data.find((x) => x.key === "community");
  return g ? { ok: true, data: { isOn: g.is_on } } : { ok: false };
}

export type StaffCandidate = { id: string; full_name: string | null; role: string };

/** Active care coordinator accounts (the database refuses grants to anyone else), read through the signed-in admin's own session (row level security applies). */
export async function loadStaffCandidates(): Promise<Loaded<StaffCandidate[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("role", "care_coordinator")
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  if (error || !data) return { ok: false };
  return { ok: true, data: data.map((r) => ({ id: r.id, full_name: r.full_name, role: r.role })) };
}

/** Whether a time has already passed. Kept out of the page component so the page stays pure. */
export function hasPassed(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}
