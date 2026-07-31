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
 * Deliberately built only from what a grantee is already entitled to read.
 * health_wallets and wallet_ledger both carry a profile_access clause in their
 * SELECT policy, so a sponsor has always been able to see a balance and a
 * ledger; nothing here widens access by a single row. vitals_readings,
 * screening_schedules and medication_reviews do NOT carry that clause, so a
 * sponsor cannot see clinical data and this hook does not pretend otherwise.
 * Whether they should is a real product decision, not something to slip in
 * behind a dashboard.
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
          "permission_level, profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account)"
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
