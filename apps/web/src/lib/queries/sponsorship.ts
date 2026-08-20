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
  /**
   * The reading before the latest one, so a number can be shown as moving
   * rather than floating. "156/96, up from 148/90" is a fact about two
   * readings; it is not a judgement about either.
   */
  previousBloodPressure: { systolic: number | null; diastolic: number | null } | null;
  /**
   * The blood-pressure target on this person's own care plan, quoted rather
   * than computed. Showing "their care team's target is under 140/90" repeats
   * what a clinician already wrote down; it does not interpret anything, and
   * without it a sponsor is looking at a number with no scale.
   */
  bloodPressureTarget: { systolic: number; diastolic: number } | null;
  latestReadingAt: string | null;
  activeConditions: string[];
  medications: {
    id: string;
    drugName: string;
    dose: string | null;
    /** When the current supply runs out, so a sponsor can settle it early. */
    refillDate: string | null;
    /**
     * Computed here rather than at render time: reading the clock during
     * render is impure and the lint rule that catches it is correct — the
     * value would differ between server and client passes.
     */
    daysUntilRefill: number | null;
  }[];
  nextScreeningDue: string | null;
  screeningsDue: number;
  riskLevel: string | null;
  /** Most recent screening result, status only — never the underlying values. */
  latestResult: { status: string; recordedAt: string } | null;
  /** Escalations still open or under review: "someone is on it", not what it is. */
  openFollowUps: number;
};

/**
 * Whether anyone is actually doing anything about it.
 *
 * This is the gap that mattered most. A sponsor could be shown a blood
 * pressure of 156/96 as a flat number while the platform had ALREADY raised a
 * doctor alert with a review deadline three days out — and never said so. The
 * alert lives in clinician_alerts, which carries the same consent clause as
 * everything else here, so the sponsor was permitted to know all along; the
 * page just queried escalations, which was empty.
 *
 * Deliberately an RPC rather than a direct read. clinician_alerts holds
 * `title` and `detail` — real clinical reasoning — and going through
 * sponsor_care_status means the interpretation cannot reach this client even
 * by accident. Counts and dates only, enforced in the function body and
 * asserted over in its own migration.
 */
export type SupportedPersonCareStatus = {
  openCount: number;
  nextReviewDue: string | null;
  reviewOverdue: boolean;
  lastReviewedAt: string | null;
};

export function useSupportedPersonCareStatus(profileId: string, hasConsent: boolean) {
  return useQuery({
    queryKey: ["sponsorship", "care-status", profileId],
    enabled: Boolean(profileId) && hasConsent,
    queryFn: async (): Promise<SupportedPersonCareStatus> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("sponsor_care_status", {
        p_beneficiary: profileId,
      });
      if (error) throw error;
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        openCount: typeof row.open_count === "number" ? row.open_count : 0,
        nextReviewDue: typeof row.next_review_due === "string" ? row.next_review_due : null,
        reviewOverdue: row.review_overdue === true,
        lastReviewedAt: typeof row.last_reviewed_at === "string" ? row.last_reviewed_at : null,
      };
    },
  });
}

/**
 * Turns a due refill into a bill the sponsor can settle.
 *
 * A medication with a refill date five days out was visible on this page and
 * completely unactionable: there was no pharmacy order to pay, and no way to
 * create one. The RPC underneath refuses anything that is not already an
 * active clinician-prescribed medication, so this asks a pharmacy to dispense
 * what a doctor already decided — it never becomes a route to a new
 * prescription.
 */
export function useSponsorRequestRefill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { beneficiaryId: string; medicationId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("sponsor_request_refill", {
        p_beneficiary: input.beneficiaryId,
        p_medication_id: input.medicationId,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sponsorship"] }),
  });
}

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
          // Two, so the latest reading can be shown as moving rather than
          // floating on its own with no scale.
          .limit(2),
        supabase
          .from("vitals_readings")
          .select("taken_at")
          .eq("patient_id", profileId)
          .order("taken_at", { ascending: false })
          .limit(1),
        supabase
          .from("care_plans")
          .select("condition, target_ranges")
          .eq("patient_id", profileId)
          .eq("status", "active"),
        supabase
          .from("medications")
          .select("id, drug_name, dose, refill_date")
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
      const priorBp = bp.data?.[1] ?? null;
      const due = (screenings.data ?? []).filter((row) => row.due_date <= today);

      // Quoted straight off whichever active care plan records one. This is
      // the clinician's own number, not a guideline this file has opinions
      // about — if no plan sets a target, none is shown.
      const bpTarget = (() => {
        for (const plan of plans.data ?? []) {
          const ranges = plan.target_ranges as Record<string, unknown> | null;
          const bpRange = ranges?.blood_pressure as Record<string, unknown> | undefined;
          const sys = bpRange?.systolic_max ?? bpRange?.systolic;
          const dia = bpRange?.diastolic_max ?? bpRange?.diastolic;
          if (typeof sys === "number" && typeof dia === "number") {
            return { systolic: sys, diastolic: dia };
          }
        }
        return null;
      })();

      return {
        latestBloodPressure: firstBp
          ? {
              systolic: firstBp.systolic,
              diastolic: firstBp.diastolic,
              takenAt: firstBp.taken_at,
            }
          : null,
        previousBloodPressure: priorBp
          ? { systolic: priorBp.systolic, diastolic: priorBp.diastolic }
          : null,
        bloodPressureTarget: bpTarget,
        latestReadingAt: latest.data?.[0]?.taken_at ?? null,
        activeConditions: (plans.data ?? []).map((row) => row.condition),
        medications: (meds.data ?? []).map((row) => ({
          id: row.id,
          drugName: row.drug_name,
          dose: row.dose,
          refillDate: row.refill_date,
          daysUntilRefill: row.refill_date
            ? Math.ceil((new Date(row.refill_date).getTime() - Date.now()) / 86_400_000)
            : null,
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
  /**
   * `video_visit` was the one order type missing, and the one most likely to
   * need somebody else to settle it: an elderly parent asked to pay up front
   * for a doctor call is exactly where a sponsor should be able to step in.
   */
  order_type: "lab" | "pharmacy" | "referral" | "video_visit";
  /** Category only. Never the specific test or drug: see sponsor_payable_orders. */
  label: string;
  amount_kobo: number;
  created_at: string;
};

const PAYABLE_ORDER_TYPES = ["lab", "pharmacy", "referral", "video_visit"] as const;

function isPayableOrder(value: unknown): value is SponsorPayableOrder {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.order_id === "string" &&
    PAYABLE_ORDER_TYPES.includes(row.order_type as (typeof PAYABLE_ORDER_TYPES)[number]) &&
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
 * Requests a self-bookable check for someone you manage.
 *
 * Self-arranged, so there is nothing to pay here: Tarragon writes down which
 * tests are needed, and they take that request to whichever laboratory suits
 * them and pay there. A supporter keeps the useful half (noticing that a check
 * is due and getting it written) and loses the half we can no longer honour,
 * because we do not take payment for tests. To help with the money, buy them a
 * year of their plan instead.
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
        // The SQL function coalesces each of these against the existing row
        // value ("blank means leave alone"), so null and undefined are
        // already equivalent at runtime - collapse null to satisfy the
        // generated (optional, non-nullable) arg type.
        p_date_of_birth: input.dateOfBirth ?? undefined,
        p_sex: input.sex ?? undefined,
        p_state: input.state ?? undefined,
        p_city: input.city ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sponsorship"] }),
  });
}
