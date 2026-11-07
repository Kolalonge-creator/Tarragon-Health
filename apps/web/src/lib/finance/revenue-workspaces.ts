import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { formatPercent } from "@/lib/analytics/format";
import { asPercent } from "./money-overview";

/**
 * Finance v2 Phase C2: Membership, family-sponsorship and employer revenue
 * (migration 20261107071746). Every function is finance-only; the list reads are
 * audited by the database.
 */

const minor = z.number().int();
const count = z.number().int();

export const membershipRevenueSchema = z.object({
  from: z.string(),
  to: z.string(),
  as_of: z.string(),
  generated_at: z.string(),
  in_force: z.object({ paid: count, individual: count, family_sponsor: count, employer: count, granted: count, voucher: count, auto_renew: count }),
  new_paid: count,
  renewals: count,
  ended_early: count,
  lapsed: count,
  expiring_30d: count,
  expiring_30d_auto_renew: count,
  renewal_due: count,
  renewal_renewed: count,
  renewal_rate: z.number().nullable(),
  failed_renewal_charges: count,
  revenue: z.object({
    gross_minor: minor,
    payments: count,
    refunds_minor: minor,
    net_minor: minor,
    renewal_gross_minor: minor,
    individual_minor: minor,
    family_sponsor_minor: minor,
    employer_minor: minor,
  }),
});
export type MembershipRevenue = z.infer<typeof membershipRevenueSchema>;

export function useMembershipRevenue(from: string, to: string) {
  return useQuery({
    queryKey: ["finance", "membership-revenue", from, to],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_membership_revenue", { p_from: from, p_to: to });
      if (error) throw error;
      return membershipRevenueSchema.parse(data);
    },
  });
}

export const MEMBERSHIP_STATES = ["active", "scheduled", "lapsed", "ended"] as const;
export const MEMBERSHIP_PAYER_TYPES = ["individual", "family_sponsor", "employer", "voucher", "granted"] as const;

export const MEMBERSHIP_STATE_LABEL: Record<string, string> = {
  active: "Active",
  scheduled: "Starts later",
  lapsed: "Lapsed",
  ended: "Ended",
};

export const MEMBERSHIP_PAYER_LABEL: Record<string, string> = {
  individual: "Paid by the member",
  family_sponsor: "Family sponsor",
  employer: "Employer",
  voucher: "Care Voucher",
  granted: "Granted (unpaid)",
};

export const membershipRowSchema = z.object({
  id: z.string(),
  state: z.string(),
  source: z.string(),
  tier: z.string(),
  payer_type: z.string(),
  beneficiary: z.string(),
  sponsor: z.string().nullable(),
  employer: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  end_reason: z.string().nullable(),
  auto_renew: z.boolean(),
  amount_paid_minor: minor.nullable(),
  paid_at: z.string().nullable(),
  paystack_reference: z.string().nullable(),
  order_id: z.string().nullable(),
  is_renewal: z.boolean(),
  renewed: z.boolean(),
});
export type MembershipRow = z.infer<typeof membershipRowSchema>;

export const membershipsPageSchema = z.object({ total: count, limit: count, offset: count, rows: z.array(membershipRowSchema) });

export interface MembershipFilters {
  states: string[];
  payerTypes: string[];
  search: string;
  expiringWithinDays: number | null;
  page: number;
}

export const MEMBERSHIP_PAGE_SIZE = 50;

export function useMembershipsList(f: MembershipFilters) {
  return useQuery({
    queryKey: ["finance", "memberships", f],
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false, // each read that returns names is audited
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_memberships_list", {
        p_states: f.states.length ? f.states : undefined,
        p_payer_types: f.payerTypes.length ? f.payerTypes : undefined,
        p_search: f.search.trim() || undefined,
        p_expiring_within_days: f.expiringWithinDays ?? undefined,
        p_limit: MEMBERSHIP_PAGE_SIZE,
        p_offset: f.page * MEMBERSHIP_PAGE_SIZE,
      });
      if (error) throw error;
      return membershipsPageSchema.parse(data);
    },
  });
}

export const sponsorshipRowSchema = z.object({
  kind: z.enum(["order", "care_voucher"]),
  record_id: z.string(),
  paid_at: z.string().nullable(),
  amount_minor: minor.nullable(),
  reference: z.string().nullable(),
  status: z.string(),
  sponsor: z.string(),
  beneficiary: z.string(),
  item: z.string().nullable(),
  membership: z
    .object({ starts_at: z.string(), ends_at: z.string().nullable(), state: z.string(), auto_renew: z.boolean() })
    .nullable(),
});
export type SponsorshipRow = z.infer<typeof sponsorshipRowSchema>;

export const sponsorshipsSchema = z.object({
  total: count,
  total_minor: minor,
  sponsors: count,
  beneficiaries: count,
  limit: count,
  offset: count,
  rows: z.array(sponsorshipRowSchema),
});

export function useSponsorships(from: string, to: string, page: number) {
  return useQuery({
    queryKey: ["finance", "sponsorships", from, to, page],
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_sponsorships", {
        p_from: from,
        p_to: to,
        p_limit: MEMBERSHIP_PAGE_SIZE,
        p_offset: page * MEMBERSHIP_PAGE_SIZE,
      });
      if (error) throw error;
      return sponsorshipsSchema.parse(data);
    },
  });
}

export const employerRevenueRowSchema = z.object({
  organisation_id: z.string(),
  name: z.string(),
  contact: z.string().nullable(),
  contract: z
    .object({
      name: z.string(),
      status: z.string(),
      effective_from: z.string().nullable(),
      effective_to: z.string().nullable(),
      employee_count: count.nullable(),
      price_per_employee_minor: minor.nullable(),
      billing_model: z.string().nullable(),
      reference: z.string().nullable(),
    })
    .nullable(),
  seats: z
    .object({
      seats: count.nullable(),
      seat_price_minor: minor.nullable(),
      value_minor: minor.nullable(),
      starts_on: z.string().nullable(),
      ends_on: z.string().nullable(),
    })
    .nullable(),
  invoiced_minor: minor,
  paid_minor: minor,
  outstanding_minor: minor,
  overdue_minor: minor,
  open_invoices: count,
  last_paid_at: z.string().nullable(),
  members_in_force: count,
  renewal_date: z.string().nullable(),
  renewal_within_60d: z.boolean().nullable(),
});
export type EmployerRevenueRow = z.infer<typeof employerRevenueRowSchema>;

export function useEmployerRevenue() {
  return useQuery({
    queryKey: ["finance", "employer-revenue"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_employer_revenue");
      if (error) throw error;
      return z.array(employerRevenueRowSchema).parse(data);
    },
  });
}

/** "3 of 4 (75%)", or a plain sentence when nothing was due: never "0%" for an empty denominator. */
export function renewalRateText(r: MembershipRevenue): string {
  if (r.renewal_rate === null || r.renewal_due === 0) return "No Memberships were due to renew in this period";
  return `${r.renewal_renewed} of ${r.renewal_due} renewed (${formatPercent(asPercent(r.renewal_rate))})`;
}

/** Employer totals across all rows. */
export function employerTotals(rows: EmployerRevenueRow[]) {
  return rows.reduce(
    (t, r) => ({
      invoiced: t.invoiced + r.invoiced_minor,
      paid: t.paid + r.paid_minor,
      outstanding: t.outstanding + r.outstanding_minor,
      overdue: t.overdue + r.overdue_minor,
      members: t.members + r.members_in_force,
    }),
    { invoiced: 0, paid: 0, outstanding: 0, overdue: 0, members: 0 }
  );
}
