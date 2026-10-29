import { z } from "zod";

// One reason rule for every admin audit path: 10 to 500 characters once trimmed. Shared with the patient lookup so they cannot drift.
export { REASON_MAX, REASON_MIN, reasonOk } from "@/lib/admin-patients/model";

/**
 * The admin patient directory (opened from the "Total patients" tile). Rows come from public.admin_patient_directory, a SECURITY DEFINER
 * function that re-checks the admin role and writes the audit row; these schemas only describe the shape and the helpers decide how
 * it is shown. No date of birth, email or clinical data is in a row, and the phone arrives already masked.
 */
export const SEGMENTS = ["all", "active", "dormant", "never", "members", "free", "new_30d", "inactive"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SORTS = ["joined", "last_active", "last_login", "time_spent", "visits", "actions", "paid", "name"] as const;
export type SortKey = (typeof SORTS)[number];

export const SEGMENT_LABEL: Record<Segment, string> = {
  all: "All patients",
  active: "Used in last 30 days",
  dormant: "Dormant (30+ days)",
  never: "Never active",
  members: "Members",
  free: "Free",
  new_30d: "Joined in last 30 days",
  inactive: "Account switched off",
};

export const PAGE_SIZE = 25;

const usage = z.object({ key: z.string(), count: z.number().int() });

export const directoryRowSchema = z.object({
  patient_id: z.string().uuid(),
  full_name: z.string().nullable(),
  patient_number: z.string().nullable(),
  phone_masked: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  age_band: z.string().nullable(),
  sex: z.string().nullable(),
  account_type: z.string(),
  is_active: z.boolean(),
  joined_at: z.string(),
  onboarded_at: z.string().nullable(),
  last_login_at: z.string().nullable(),
  login_count: z.number().int(),
  last_active_at: z.string().nullable(),
  activity_status: z.enum(["active", "dormant", "never"]),
  visits_total: z.number().int(),
  visits_30d: z.number().int(),
  active_days_30d: z.number().int(),
  time_spent_seconds: z.number(),
  avg_visit_seconds: z.number(),
  main_device: z.string().nullable(),
  actions_total: z.number().int(),
  actions_30d: z.number().int(),
  last_action_at: z.string().nullable(),
  top_actions: z.array(usage),
  top_sections: z.array(usage),
  plan: z.string(),
  membership_state: z.string().nullable(),
  membership_source: z.string().nullable(),
  membership_started_at: z.string().nullable(),
  membership_ends_at: z.string().nullable(),
  auto_renew: z.boolean(),
  purchases_count: z.number().int(),
  paid_total_kobo: z.number(),
  last_purchase_at: z.string().nullable(),
});
export type DirectoryRow = z.infer<typeof directoryRowSchema>;

export const summarySchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  dormant: z.number().int(),
  never: z.number().int(),
  members: z.number().int(),
  free: z.number().int(),
  inactive: z.number().int(),
  account_active: z.number().int(),
  new_30d: z.number().int(),
  avg_time_spent_seconds: z.number(),
  paid_total_kobo: z.number(),
});
export type DirectorySummary = z.infer<typeof summarySchema>;

export const pageSchema = z.object({ summary: summarySchema, matching: z.number().int(), rows: z.array(directoryRowSchema) });
export type DirectoryPage = z.infer<typeof pageSchema>;
export const exportSchema = z.object({ rows: z.array(directoryRowSchema) });

export const queryInput = z.object({
  search: z.string().trim().max(80).default(""),
  segment: z.enum(SEGMENTS).default("all"),
  sort: z.enum(SORTS).default("joined"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(0).default(0),
});
export type DirectoryQuery = z.infer<typeof queryInput>;

// Names for the raw keys the database returns. An unknown key is shown as written, never dropped.
const ACTION_LABEL: Record<string, string> = {
  health_log: "Logged health information",
  wellness_points: "Earned wellness points",
  care_message: "Messaged the care team",
  health_education: "Read health education",
  activity_log: "Logged activity",
  lifestyle_measurement: "Lifestyle programme entry",
  video_visit: "Video visit",
};
export function actionLabel(key: string): string {
  return ACTION_LABEL[key] ?? key.replace(/_/g, " ");
}
export function sectionLabel(key: string): string {
  const spaced = key.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
export function topList(items: { key: string; count: number }[], label: (k: string) => string): string {
  return items.map((i) => `${label(i.key)} (${i.count})`).join(", ");
}

/** "Membership Plus" etc. A member whose membership ended or lapsed is not shown as plain Free. */
export function planLabel(row: Pick<DirectoryRow, "plan" | "membership_state">): string {
  if (row.plan === "plus") return "Membership Plus";
  if (row.plan === "evergreen") return "Membership";
  if (row.membership_state === "ended") return "Free (membership ended)";
  if (row.membership_state === "lapsed") return "Free (membership lapsed)";
  return "Free";
}

/** 0 -> "0 min"; 839 -> "14 min"; 5400 -> "1 h 30 min". Seconds under a minute round up so a real visit never reads as zero. */
export function formatDuration(seconds: number): string {
  if (!(seconds > 0)) return "0 min";
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function statusLabel(s: DirectoryRow["activity_status"]): string {
  return s === "active" ? "Active (30 days)" : s === "dormant" ? "Dormant" : "Never active";
}
