import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type WalletEntryType = Tables<"wallet_ledger">["entry_type"];

export type SupportedPersonActivity = {
  id: string;
  createdAt: string;
  entryType: WalletEntryType;
  amountKobo: number;
  note: string | null;
  orderType: string | null;
};

export type SupportedPerson = {
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  /** The record owner has said this person may see their health information. */
  clinicalAccess: boolean;
  isDependentAccount: boolean;
  walletId: string | null;
  balanceKobo: number;
  /** Money put in by anyone, ever. */
  fundedKobo: number;
  /** Money that has actually turned into care. */
  spentKobo: number;
  lastFundedAt: string | null;
  /** Newest first, already filtered to entries a sponsor would call a receipt. */
  recentSpends: SupportedPersonActivity[];
  goal: { name: string; targetKobo: number } | null;
};

/** Ledger entry types that represent money going in. */
const CREDIT_TYPES: WalletEntryType[] = [
  "topup",
  "sponsor_topup",
  "referral_reward",
  "prevention_reward",
  "refund",
];

/**
 * Everyone the caller supports, with the money side of each relationship.
 *
 * Money only, still. health_wallets and wallet_ledger have always carried a
 * profile_access clause in their SELECT policy, so nothing here widens access
 * by a single row.
 *
 * Clinical data is a separate question and now has a separate answer: since
 * 20260731181143 a record owner may consent, per person, to being read, and
 * clinicalAccess on each row below reports whether they have. The health
 * itself is fetched by useSupportedPersonHealth, and only for someone who
 * said yes.
 *
 * Four queries total no matter how many people are supported: the grants, then
 * wallets, ledgers and goals fetched in one batch each and stitched in memory.
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

      const profileIds = people.map((p) => p.profileId);

      const { data: wallets } = await supabase
        .from("health_wallets")
        .select("id, profile_id, balance_kobo")
        .in("profile_id", profileIds);

      const walletByProfile = new Map((wallets ?? []).map((w) => [w.profile_id, w]));
      const walletIds = (wallets ?? []).map((w) => w.id);

      const [{ data: ledger }, { data: goals }] = await Promise.all([
        walletIds.length
          ? supabase
              .from("wallet_ledger")
              .select("id, wallet_id, entry_type, amount_kobo, note, booking_order_type, created_at")
              .in("wallet_id", walletIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] as never[] }),
        walletIds.length
          ? supabase
              .from("wallet_savings_goals")
              .select("wallet_id, name, target_kobo")
              .in("wallet_id", walletIds)
              .eq("status", "active")
          : Promise.resolve({ data: [] as never[] }),
      ]);

      const goalByWallet = new Map((goals ?? []).map((g) => [g.wallet_id, g]));

      return people.map((person) => {
        const wallet = walletByProfile.get(person.profileId) ?? null;
        const entries = (ledger ?? []).filter((e) => e.wallet_id === wallet?.id);

        let fundedKobo = 0;
        let spentKobo = 0;
        let lastFundedAt: string | null = null;

        for (const entry of entries) {
          const amount = Math.abs(entry.amount_kobo);
          if (CREDIT_TYPES.includes(entry.entry_type)) {
            fundedKobo += amount;
            // Entries arrive newest first, so the first credit seen is the latest.
            if (lastFundedAt === null) lastFundedAt = entry.created_at;
          } else if (entry.entry_type === "spend") {
            spentKobo += amount;
          }
        }

        const goal = wallet ? (goalByWallet.get(wallet.id) ?? null) : null;

        return {
          profileId: person.profileId,
          fullName: person.fullName,
          permissionLevel: person.permissionLevel,
          clinicalAccess: person.clinicalAccess,
          isDependentAccount: person.isDependentAccount,
          walletId: wallet?.id ?? null,
          balanceKobo: wallet?.balance_kobo ?? 0,
          fundedKobo,
          spentKobo,
          lastFundedAt,
          recentSpends: entries
            .filter((e) => e.entry_type === "spend")
            .slice(0, 5)
            .map((e) => ({
              id: e.id,
              createdAt: e.created_at,
              entryType: e.entry_type,
              amountKobo: Math.abs(e.amount_kobo),
              note: e.note,
              orderType: e.booking_order_type,
            })),
          goal: goal ? { name: goal.name, targetKobo: goal.target_kobo } : null,
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

      const [bp, latest, plans, meds, screenings, risk] = await Promise.all([
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

/** Settles one pending bill from the balance the sponsor funded. */
export function useSponsorPayOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      beneficiaryId: string;
      orderType: SponsorPayableOrder["order_type"];
      orderId: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("sponsor_pay_booking_order", {
        p_beneficiary: input.beneficiaryId,
        p_order_type: input.orderType,
        p_order_id: input.orderId,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sponsorship"] }),
  });
}

/**
 * Books a self-bookable check for someone you manage, paying immediately when
 * the wallet already covers it. A short balance leaves a real pending bill
 * rather than failing, which then shows up in useSponsorPayableOrders.
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
      return data as { ok: boolean; paid: boolean; price_kobo: number; shortfall_kobo: number };
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
