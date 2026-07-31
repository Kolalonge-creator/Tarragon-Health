import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type SupportedPersonVoucher = {
  id: string;
  voucherNumber: string;
  label: string;
  status: string;
  faceValueKobo: number;
  amountPaidKobo: number;
  expiresAt: string | null;
  redeemedAt: string | null;
  boughtByMe: boolean;
};

export type SupportedPerson = {
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  /** The record owner has said this person may see their health information. */
  clinicalAccess: boolean;
  isDependentAccount: boolean;
  /** Bought and fully paid, waiting to be used. */
  readyVouchers: SupportedPersonVoucher[];
  /** Still being paid for. */
  savingVouchers: SupportedPersonVoucher[];
  /** Already turned into care, newest first. The sponsor's receipts. */
  usedVouchers: SupportedPersonVoucher[];
  /** Money this person has put in across every voucher they bought. */
  fundedKobo: number;
  lastFundedAt: string | null;
};

/**
 * Everyone the caller supports, with the money side of each relationship.
 *
 * Money only, still. care_vouchers has carried a profile_access clause in its
 * SELECT policy since it was created, so nothing here widens access by a
 * single row. A voucher names a service, so a sponsor sees "an Annual Health
 * Check was bought and later used" and never a result.
 *
 * Clinical data is a separate question with a separate answer: since
 * 20260731181143 a record owner may consent, per person, to being read, and
 * clinicalAccess on each row below reports whether they have. The health
 * itself is fetched by useSupportedPersonHealth, and only for someone who
 * said yes.
 *
 * Two queries total no matter how many people are supported: the grants, then
 * every voucher for all of them in one batch, stitched in memory.
 */
export function useSupportedPeople() {
  return useQuery({
    queryKey: ["sponsorship", "supported-people"],
    queryFn: async (): Promise<SupportedPerson[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: grants, error: grantsError } = await supabase
        .from("profile_access")
        .select(
          "permission_level, clinical_access, profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account)"
        )
        .eq("grantee_user_id", user.id);
      if (grantsError) throw grantsError;

      const people = (grants ?? [])
        .flatMap((row) => {
          const profile = row.profile;
          if (!profile) return [];
          return [
            {
              profileId: profile.id,
              fullName: profile.full_name,
              isDependentAccount: profile.is_dependent_account === true,
              permissionLevel: row.permission_level as "view" | "manage",
              clinicalAccess: row.clinical_access === true,
            },
          ];
        })
        .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));

      if (people.length === 0) return [];

      const { data: vouchers } = await supabase
        .from("care_vouchers")
        .select(
          "id, beneficiary_profile_id, purchaser_profile_id, voucher_number, sku_name, kind, status, face_value_kobo, amount_paid_kobo, expires_at, redeemed_at, created_at"
        )
        .in(
          "beneficiary_profile_id",
          people.map((p) => p.profileId)
        )
        .order("created_at", { ascending: false });

      return people.map((person) => {
        const mine = (vouchers ?? []).filter((v) => v.beneficiary_profile_id === person.profileId);

        const shape = (v: (typeof mine)[number]): SupportedPersonVoucher => ({
          id: v.id,
          voucherNumber: v.voucher_number,
          label: v.sku_name ?? (v.kind === "reward_discount" ? "Reward voucher" : "Care voucher"),
          status: v.status,
          faceValueKobo: v.face_value_kobo,
          amountPaidKobo: v.amount_paid_kobo,
          expiresAt: v.expires_at,
          redeemedAt: v.redeemed_at,
          boughtByMe: v.purchaser_profile_id === user.id,
        });

        const boughtByMe = mine.filter((v) => v.purchaser_profile_id === user.id);
        const fundedKobo = boughtByMe.reduce((sum, v) => sum + v.amount_paid_kobo, 0);
        const lastFunded = boughtByMe.find((v) => v.amount_paid_kobo > 0);

        return {
          profileId: person.profileId,
          fullName: person.fullName,
          permissionLevel: person.permissionLevel,
          clinicalAccess: person.clinicalAccess,
          isDependentAccount: person.isDependentAccount,
          readyVouchers: mine.filter((v) => v.status === "active").map(shape),
          savingVouchers: mine.filter((v) => v.status === "reserved").map(shape),
          usedVouchers: mine
            .filter((v) => v.status === "redeemed")
            .slice(0, 5)
            .map(shape),
          fundedKobo,
          lastFundedAt: lastFunded?.created_at ?? null,
        };
      });
    },
  });
}

export type SupportedPersonHealth = {
  latestBloodPressure: { systolic: number | null; diastolic: number | null; takenAt: string } | null;
  latestReadingAt: string | null;
  activeConditions: string[];
  medications: { id: string; drugName: string; dose: string | null }[];
  nextScreeningDue: string | null;
  screeningsDue: number;
  riskLevel: string | null;
  /** Most recent screening result, status only — never the underlying values. */
  latestResult: { status: string; recordedAt: string } | null;
  /** Escalations still open or under review: "someone is on it", not what it is. */
  openFollowUps: number;
};

/**
 * How the person you support is actually doing.
 *
 * Every table read here gained a consent-gated clause in the same migration
 * that created the consent (20260731181143), so this hook needs no special
 * privilege and no service-role client: if the patient has not said yes, these
 * queries return nothing at all, and the card simply does not render. `enabled`
 * mirrors that in the client so a revoked sponsor does not fire six pointless
 * requests, but it is not what enforces it.
 *
 * Read-only by construction. There is deliberately no mutation anywhere in this
 * file that touches a clinical table.
 */
export function useSupportedPersonHealth(profileId: string, hasConsent: boolean) {
  return useQuery({
    queryKey: ["sponsorship", "health", profileId],
    enabled: Boolean(profileId) && hasConsent,
    queryFn: async (): Promise<SupportedPersonHealth> => {
      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);

      const [bp, latest, plans, meds, screenings, risk, results, followUps] = await Promise.all([
        supabase
          .from("vitals_readings")
          .select("systolic, diastolic, taken_at")
          .eq("patient_id", profileId)
          .eq("vital_type", "blood_pressure")
          .order("taken_at", { ascending: false })
          .limit(1),
        supabase
          .from("vitals_readings")
          .select("taken_at")
          .eq("patient_id", profileId)
          .order("taken_at", { ascending: false })
          .limit(1),
        supabase
          .from("care_plans")
          .select("condition")
          .eq("patient_id", profileId)
          .eq("status", "active"),
        supabase
          .from("medications")
          .select("id, drug_name, dose")
          .eq("patient_id", profileId)
          .eq("is_active", true)
          .order("drug_name"),
        supabase
          .from("screening_schedules")
          .select("due_date")
          .eq("patient_id", profileId)
          .in("status", ["pending", "booked", "overdue"])
          .order("due_date", { ascending: true }),
        supabase
          .from("patient_risk_scores")
          .select("risk_level")
          .eq("patient_id", profileId)
          .order("computed_at", { ascending: false })
          .limit(1),
        supabase
          .from("screening_results")
          .select("result_status, created_at")
          .eq("patient_id", profileId)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("escalations")
          .select("id")
          .eq("patient_id", profileId)
          .in("status", ["open", "under_review"]),
      ]);

      const firstBp = bp.data?.[0] ?? null;
      const due = (screenings.data ?? []).filter((row) => row.due_date <= today);

      return {
        latestBloodPressure: firstBp
          ? {
              systolic: firstBp.systolic,
              diastolic: firstBp.diastolic,
              takenAt: firstBp.taken_at,
            }
          : null,
        latestReadingAt: latest.data?.[0]?.taken_at ?? null,
        activeConditions: (plans.data ?? []).map((row) => row.condition),
        medications: (meds.data ?? []).map((row) => ({
          id: row.id,
          drugName: row.drug_name,
          dose: row.dose,
        })),
        nextScreeningDue: screenings.data?.[0]?.due_date ?? null,
        screeningsDue: due.length,
        riskLevel: risk.data?.[0]?.risk_level ?? null,
        latestResult: results.data?.[0]
          ? {
              status: results.data[0].result_status,
              recordedAt: results.data[0].created_at,
            }
          : null,
        openFollowUps: (followUps.data ?? []).length,
      };
    },
  });
}

export type SponsorPayableOrder = {
  order_id: string;
  order_type: "lab" | "pharmacy" | "referral";
  /** Category only. Never the specific test or drug: see sponsor_payable_orders. */
  label: string;
  amount_kobo: number;
  created_at: string;
};

function isPayableOrder(value: unknown): value is SponsorPayableOrder {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.order_id === "string" &&
    (row.order_type === "lab" || row.order_type === "pharmacy" || row.order_type === "referral") &&
    typeof row.label === "string" &&
    typeof row.amount_kobo === "number"
  );
}

/**
 * Bills the caller may settle for someone they manage.
 *
 * Only reachable with a 'manage' grant, and the RPC returns a category rather
 * than the item, so this can show "A lab test, ₦18,000" and never "Cervical
 * smear". Disabled for 'view' grantees, who would simply be refused.
 */
export function useSponsorPayableOrders(profileId: string | null, canManage: boolean) {
  return useQuery({
    queryKey: ["sponsorship", "payable-orders", profileId],
    enabled: Boolean(profileId) && canManage,
    queryFn: async (): Promise<SponsorPayableOrder[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("sponsor_payable_orders", {
        p_beneficiary: profileId as string,
      });
      if (error) throw error;
      return Array.isArray(data) ? data.filter(isPayableOrder) : [];
    },
  });
}

/**
 * Settles one pending bill with a voucher the person already holds.
 *
 * A sponsor with a 'manage' grant can press this, which is the point of the
 * whole arrangement: the person least likely to complete a checkout is often
 * the one the care is for. The voucher can still only ever become care for its
 * own named beneficiary, so there is nothing here to redirect.
 */
export function useSponsorPayOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      beneficiaryId: string;
      voucherId: string;
      orderType: SponsorPayableOrder["order_type"];
      orderId: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("redeem_care_voucher", {
        p_voucher: input.voucherId,
        p_order_type: input.orderType,
        p_order_id: input.orderId,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sponsorship"] }),
  });
}

/**
 * Books a self-bookable check for someone you manage. If they already hold a
 * paid voucher for that exact check it is used immediately; otherwise the
 * booking is created as a real pending bill, which then shows up in
 * useSponsorPayableOrders.
 */
export function useSponsorBookCare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { beneficiaryId: string; bundleCode: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("sponsor_book_care", {
        p_beneficiary: input.beneficiaryId,
        p_bundle_code: input.bundleCode,
      });
      if (error) throw error;
      return data as { ok: boolean; paid: boolean; price_kobo: number; voucher_id: string | null };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sponsorship"] }),
  });
}

/**
 * Fills in a managed person's non-clinical basics from the sponsor's own
 * device. Consent stays theirs: this shortens their remaining step, it does not
 * remove it.
 */
export function useSponsorSetBasics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      beneficiaryId: string;
      dateOfBirth?: string | null;
      sex?: string | null;
      state?: string | null;
      city?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("sponsor_set_dependent_basics", {
        p_beneficiary: input.beneficiaryId,
        p_date_of_birth: input.dateOfBirth ?? null,
        p_sex: input.sex ?? null,
        p_state: input.state ?? null,
        p_city: input.city ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sponsorship"] }),
  });
}
