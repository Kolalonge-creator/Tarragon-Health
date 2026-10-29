import { actionLabel, planLabel, sectionLabel, statusLabel, topList, type DirectoryRow } from "./model";
import type { Cell, XlsxColumn } from "./xlsx";

/** Lagos is UTC+1 all year. Dates in the file are written as Lagos wall-clock time to match the page. */
export const LAGOS_UTC_OFFSET_HOURS = 1;

export const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "Patient number", width: 14 },
  { header: "Name", width: 26 },
  { header: "Phone (masked)", width: 16 },
  { header: "City", width: 16 },
  { header: "State", width: 14 },
  { header: "Age band", width: 10 },
  { header: "Sex", width: 9 },
  { header: "Account type", width: 12 },
  { header: "Account switched on", width: 12 },
  { header: "Joined (Lagos time)", kind: "date", width: 18 },
  { header: "Finished onboarding (Lagos time)", kind: "date", width: 18 },
  { header: "Plan", width: 24 },
  { header: "Membership source", width: 16 },
  { header: "Membership started (Lagos time)", kind: "date", width: 18 },
  { header: "Membership ends (Lagos time)", kind: "date", width: 18 },
  { header: "Renews automatically", width: 12 },
  { header: "Last sign-in (Lagos time)", kind: "date", width: 18 },
  { header: "Sign-ins (devices total)", kind: "number", width: 12 },
  { header: "Last activity (Lagos time)", kind: "date", width: 18 },
  { header: "Activity status", width: 16 },
  { header: "Visits (all time)", kind: "number", width: 12 },
  { header: "Visits (30 days)", kind: "number", width: 12 },
  { header: "Active days (30 days)", kind: "number", width: 12 },
  { header: "Est. time on platform (minutes)", kind: "number", width: 16 },
  { header: "Avg visit (minutes)", kind: "number", width: 12 },
  { header: "Main device", width: 11 },
  { header: "Actions (all time)", kind: "number", width: 12 },
  { header: "Actions (30 days)", kind: "number", width: 12 },
  { header: "Last action (Lagos time)", kind: "date", width: 18 },
  { header: "Most frequent actions", width: 50 },
  { header: "Most visited sections", width: 40 },
  { header: "Paid purchases", kind: "number", width: 10 },
  { header: "Paid in total (NGN)", kind: "money", width: 16 },
  { header: "Last paid purchase (Lagos time)", kind: "date", width: 18 },
];

const d = (iso: string | null): Cell => (iso ? new Date(iso) : null);
const minutes = (s: number): number => Math.round((s / 60) * 10) / 10;

export function exportRow(r: DirectoryRow): Cell[] {
  return [
    r.patient_number, r.full_name, r.phone_masked, r.city, r.state, r.age_band, r.sex, r.account_type, r.is_active ? "Yes" : "No",
    d(r.joined_at), d(r.onboarded_at), planLabel(r), r.membership_source, d(r.membership_started_at), d(r.membership_ends_at),
    r.plan === "free" ? null : r.auto_renew ? "Yes" : "No",
    d(r.last_login_at), r.login_count, d(r.last_active_at), statusLabel(r.activity_status),
    r.visits_total, r.visits_30d, r.active_days_30d, minutes(r.time_spent_seconds), minutes(r.avg_visit_seconds), r.main_device,
    r.actions_total, r.actions_30d, d(r.last_action_at), topList(r.top_actions, actionLabel), topList(r.top_sections, sectionLabel),
    r.purchases_count, r.paid_total_kobo / 100, d(r.last_purchase_at),
  ];
}
