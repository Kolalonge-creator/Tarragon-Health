import { getProposedConfig } from "@tarragon/shared";
import type { DirectoryRow } from "./directory";

/**
 * The HR overview's "Workforce and compliance attention" list and its headline counts (HR Phase A). Built only from real
 * records: the employment history, the account state and the clinician's licence and indemnity dates as clinical_staff
 * holds them. Each item stands alone; there is deliberately no blended compliance score (spec section 14), and an
 * unverified credential is never counted as compliant.
 */
export type Priority = "high" | "medium" | "low";

export type AttentionKind =
  | "left_but_account_active"
  | "employment_record_missing"
  | "contract_end_passed"
  | "contract_ending"
  | "licence_expired"
  | "licence_expiring"
  | "credential_unverified"
  | "not_cleared_for_clinical_work"
  | "indemnity_expired"
  | "indemnity_expiring"
  | "indemnity_not_recorded"
  | "no_line_manager"
  | "no_emergency_contact"
  | "training_overdue"
  | "training_pending_verification";

export interface AttentionItem {
  kind: AttentionKind;
  profileId: string;
  name: string;
  department: string | null;
  priority: Priority;
  issue: string;
  due: string | null;
  nextAction: string;
  /** Where the fix happens: the HR profile, or the authoritative page that owns the record. */
  href: string;
}

export interface AttentionWindows {
  licence_warn_days: number;
  indemnity_warn_days: number;
  contract_warn_days: number;
  training_warn_days: number;
}

/** The warning windows (registry key hr.attention_windows). */
export function attentionWindows(): AttentionWindows {
  return getProposedConfig("hr.attention_windows").value as unknown as AttentionWindows;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in Lagos as YYYY-MM-DD. */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `today` (YYYY-MM-DD) to a date or timestamp, read as a Lagos calendar date; negative when past. */
export function daysUntil(dateOrTimestamp: string, today: string): number {
  const target = dateOrTimestamp.length === 10 ? dateOrTimestamp : lagosToday(new Date(dateOrTimestamp));
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

function dateOnly(dateOrTimestamp: string): string {
  return dateOrTimestamp.length === 10 ? dateOrTimestamp : lagosToday(new Date(dateOrTimestamp));
}

/** A staff member who has not left, and either has an employment record or a platform account that is on. */
export function isCurrentStaff(r: DirectoryRow): boolean {
  return r.employment_status !== "left" && (r.account_active || r.employment_status !== null);
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const CREDENTIAL_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>([
  "licence_expired", "licence_expiring", "credential_unverified", "not_cleared_for_clinical_work",
  "indemnity_expired", "indemnity_expiring", "indemnity_not_recorded",
]);

export function buildAttention(rows: DirectoryRow[], today: string, windows: AttentionWindows = attentionWindows()): AttentionItem[] {
  const managers = new Set(rows.map((r) => r.line_manager_id).filter((id): id is string => id !== null));
  const items: AttentionItem[] = [];

  for (const r of rows) {
    const name = r.full_name ?? "Unnamed account";
    const base = { profileId: r.profile_id, name, department: r.department_name };
    const profile = `/admin/people/${r.profile_id}`;

    if (r.employment_status === "left" && r.account_active) {
      items.push({ ...base, kind: "left_but_account_active", priority: "high", issue: "Has left but can still sign in", due: null,
        nextAction: "Switch off their platform access on their member page", href: `/admin/members/${r.profile_id}` });
    }
    if (!isCurrentStaff(r)) continue;

    if (!r.has_employment_record && r.account_active) {
      items.push({ ...base, kind: "employment_record_missing", priority: "medium", issue: "No employment record", due: null,
        nextAction: "Record their appointment", href: profile });
    }
    if (r.contract_end_date) {
      const d = daysUntil(r.contract_end_date, today);
      if (d < 0) {
        items.push({ ...base, kind: "contract_end_passed", priority: "high", issue: "Contract end date has passed", due: r.contract_end_date,
          nextAction: "Record a renewal or their leaving", href: profile });
      } else if (d <= windows.contract_warn_days) {
        items.push({ ...base, kind: "contract_ending", priority: "medium", issue: `Contract ends in ${d} ${d === 1 ? "day" : "days"}`,
          due: r.contract_end_date, nextAction: "Decide on renewal", href: profile });
      }
    }
    if (r.is_clinician && r.clinician_status !== "offboarded") {
      // Credentialing's own verdict: a recorded primary-source check, or grandfathering while it lasts.
      if (r.verification_satisfied === false) {
        items.push({ ...base, kind: "credential_unverified", priority: "high", issue: "Registration not verified at source", due: null,
          nextAction: "Record the MDCN primary-source check in credentialing", href: "/admin/credentialing" });
      }
      if (r.licence_expires_at) {
        const d = daysUntil(r.licence_expires_at, today);
        if (d < 0) {
          items.push({ ...base, kind: "licence_expired", priority: "high", issue: "Practising licence expired", due: dateOnly(r.licence_expires_at),
            nextAction: "Renew through clinician credentialing", href: "/admin/credentialing/expiry" });
        } else if (d <= windows.licence_warn_days) {
          items.push({ ...base, kind: "licence_expiring", priority: "medium", issue: `Practising licence expires in ${d} ${d === 1 ? "day" : "days"}`,
            due: dateOnly(r.licence_expires_at), nextAction: "Ask for the renewed licence", href: "/admin/credentialing/expiry" });
        }
      }
      if (r.indemnity_required && !r.indemnity_exempt) {
        if (!r.indemnity_expires_at) {
          items.push({ ...base, kind: "indemnity_not_recorded", priority: "high", issue: "Indemnity cover not recorded", due: null,
            nextAction: "Record their indemnity on clinical staff", href: "/admin/settings/clinical-staff" });
        } else {
          const d = daysUntil(r.indemnity_expires_at, today);
          if (d < 0) {
            items.push({ ...base, kind: "indemnity_expired", priority: "high", issue: "Indemnity cover expired", due: dateOnly(r.indemnity_expires_at),
              nextAction: "Record renewed cover", href: "/admin/credentialing/expiry" });
          } else if (d <= windows.indemnity_warn_days) {
            items.push({ ...base, kind: "indemnity_expiring", priority: "medium", issue: `Indemnity cover expires in ${d} ${d === 1 ? "day" : "days"}`,
              due: dateOnly(r.indemnity_expires_at), nextAction: "Ask for renewed cover", href: "/admin/credentialing/expiry" });
          }
        }
      }
    }
    // Anything else credentialing holds against them (a restriction, a missing date, an ended grace period).
    if (r.is_clinician && r.clinician_status === "active" && r.cleared_to_practise === false
        && !items.some((i) => i.profileId === r.profile_id && CREDENTIAL_KINDS.has(i.kind))) {
      items.push({ ...base, kind: "not_cleared_for_clinical_work", priority: "high", issue: "Not cleared for clinical work", due: null,
        nextAction: "See why in clinician credentialing", href: "/admin/credentialing/expiry" });
    }
    // The person at the top of the organisation manages others; only someone who neither has nor is a manager is flagged.
    if (r.has_employment_record && !r.line_manager_id && !managers.has(r.profile_id)) {
      items.push({ ...base, kind: "no_line_manager", priority: "low", issue: "No line manager recorded", due: null,
        nextAction: "Record who they report to", href: profile });
    }
    if (r.account_active && !r.has_emergency_contact) {
      items.push({ ...base, kind: "no_emergency_contact", priority: "low", issue: "No emergency contact", due: null,
        nextAction: "Ask them to add one, or add it on their profile", href: `${profile}?tab=personal` });
    }
  }

  return sortAttention(items);
}

/** High before medium before low, then soonest due, then name. Used for every attention list, merged or not. */
export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.name.localeCompare(b.name)
  );
}

export interface PeopleKpis {
  activeStaff: number;
  activeClinical: number;
  activeNonClinical: number;
  onboarding: number;
  credentialsNeedingAttention: number;
}

/** Working staff: sign-in on, and not onboarding, suspended or left (someone with no record yet counts until recorded). */
export function isActiveStaff(r: DirectoryRow): boolean {
  return r.account_active && (r.employment_status === null || r.employment_status === "active");
}

export function buildKpis(rows: DirectoryRow[], attention: AttentionItem[]): PeopleKpis {
  const active = rows.filter(isActiveStaff);
  return {
    activeStaff: active.length,
    activeClinical: active.filter((r) => r.is_clinician).length,
    activeNonClinical: active.filter((r) => !r.is_clinician).length,
    onboarding: rows.filter((r) => r.employment_status === "onboarding").length,
    credentialsNeedingAttention: new Set(attention.filter((a) => CREDENTIAL_KINDS.has(a.kind)).map((a) => a.profileId)).size,
  };
}

/** Counts by a label, largest first, for the composition breakdowns. Missing values are counted as "Not recorded". */
export function countBy(rows: DirectoryRow[], key: (r: DirectoryRow) => string | null): Array<{ label: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? "Not recorded";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface DirectoryFilter {
  q?: string;
  department?: string;
  status?: string;
  role?: string;
  clinical?: "clinical" | "non_clinical";
  includeTest?: boolean;
}

export function filterDirectory(rows: DirectoryRow[], f: DirectoryFilter): DirectoryRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (!f.includeTest && r.is_test) return false;
    if (q && ![r.full_name, r.staff_number, r.job_title].some((v) => v?.toLowerCase().includes(q))) return false;
    if (f.department && r.department_id !== f.department) return false;
    if (f.status === "no_record" ? r.has_employment_record : f.status && r.employment_status !== f.status) return false;
    if (f.role && r.role !== f.role) return false;
    if (f.clinical === "clinical" && !r.is_clinician) return false;
    if (f.clinical === "non_clinical" && r.is_clinician) return false;
    return true;
  });
}
