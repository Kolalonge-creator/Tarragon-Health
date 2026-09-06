import type { Database } from "@tarragon/shared";

type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * Who can actually read partner_statements, mirrored from private.is_org_staff.
 *
 * This is the odd one out among the "a failed query must not read as good
 * news" fixes, because there is no failed query to catch. partner_statements'
 * only policy is
 *
 *     for all to authenticated using (private.is_org_staff(organisation_id))
 *
 * (20260821192256_partner_billing_reconcile_settle_refund.sql), and
 * private.is_org_staff explicitly excludes the `finance` role among others
 * (20260829092521_harden_is_org_staff_exclude_payer_and_provider_org.sql, the
 * current definition; the exclusion itself dates from 20260729194127). RLS on
 * a SELECT filters rows, it does not raise — so a finance officer's read comes
 * back `{ data: [], error: null }`, and /finance/partner-settlements told them
 * "No laboratory statements recorded yet."
 *
 * That is a settlement ledger reporting nothing owed to a partner laboratory,
 * to the one person whose job is paying it, every single time. Error handling
 * cannot fix it: there is no error. The screen has to know the reader cannot
 * see this table and say so.
 *
 * The write side is a separate gate again: approve_partner_statement adds a
 * finance.vendors.manage check on top, so `finance` is not simply "less
 * privileged here" — the split is deliberate in that migration's own design,
 * which treats recording what a lab delivered as a care-team operations
 * question rather than an accounting one. This module does not change any of
 * that; it only stops the UI from misreporting it.
 *
 * Keep this list in step with private.is_org_staff. If a role is added to the
 * enum and not classified here, it is treated as able to see them, which is
 * the same direction the DB errs (the DB's own list is an exclusion list too).
 */
const ROLES_EXCLUDED_FROM_ORG_STAFF: ReadonlySet<UserRole> = new Set<UserRole>([
  // A patient is never org staff.
  "patient",
  // I9: an institution administrator is not care-team staff.
  "corporate_admin",
  "hmo_admin",
  // Partner employees.
  "pharmacist",
  "lab_partner",
  "lab_liaison",
  // Back-office roles. `finance` is the one that reaches this page.
  "finance",
  "analyst",
  // Counterparty platform roles (modules 27 and 28).
  "payer_admin",
  "provider_org_staff",
]);

export function canReadPartnerStatements(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  // `admin` passes private.is_org_staff regardless of organisation.
  return !ROLES_EXCLUDED_FROM_ORG_STAFF.has(role);
}

/**
 * The line the page shows in place of "No laboratory statements recorded yet."
 * when the reader is one of the roles RLS filters out. `null` means the reader
 * can genuinely see the table and an empty list genuinely means empty.
 *
 * Written to be useful rather than apologetic: it says what the reader is
 * looking at, why, and who to ask, without implying a fault or a broken page.
 */
export function partnerStatementAccessNotice(role: UserRole | null | undefined): string | null {
  if (canReadPartnerStatements(role)) return null;
  return (
    "Your account cannot see laboratory settlement statements, so this list is empty whether or " +
    "not any exist. Recording and matching a partner invoice is held with care-team operations " +
    "rather than the finance role. Ask an administrator to record it, or to grant your account " +
    "the access, and it will appear here."
  );
}
