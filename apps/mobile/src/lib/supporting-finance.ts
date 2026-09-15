import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * The money half of "People you support" — apps/web/.../patient/supporting/'s
 * useSupportedPeople (apps/web/src/lib/queries/sponsorship.ts). Same query
 * direction as acting.ts's loadPeopleISupport (`grantee_user_id = me`), just
 * carrying the voucher/funding fields that screen doesn't need. Read-only:
 * every write in the web page this mirrors is either a Paystack checkout
 * redirect (paySomeonesBill/paySomeonesPlan/splitBillWithThem) or a
 * booking/refill/messaging mutation, none of which belongs in a one-pass
 * native port — see supporting-manage-screen.tsx's doc comment for why those
 * stay a system-browser hand-off to the real web page instead of a
 * reimplementation.
 */

export type SupportedPersonVoucherStatus = "active" | "reserved" | "redeemed" | "expired" | "cancelled";

export interface SupportedPersonVoucher {
  id: string;
  voucherNumber: string;
  label: string;
  status: SupportedPersonVoucherStatus;
  faceValueKobo: number;
  amountPaidKobo: number;
  redeemedAt: string | null;
  boughtByMe: boolean;
}

export interface SupportedPersonFinance {
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  isDependentAccount: boolean;
  /** Bought and fully paid, waiting to be used. */
  readyVouchers: SupportedPersonVoucher[];
  /** Still being paid for. */
  savingVouchers: SupportedPersonVoucher[];
  /** Already turned into care, newest first, capped at 5 — same cap as web. */
  usedVouchers: SupportedPersonVoucher[];
  /** Money this person has put in across every voucher they bought. */
  fundedKobo: number;
  lastFundedAt: string | null;
}

/**
 * Mirrors useSupportedPeople column-for-column: the grants, then every
 * voucher for all of them in one batch, stitched in memory. care_vouchers'
 * own SELECT policy already carries a profile_access clause, so this widens
 * nothing beyond what RLS already allows — same as the web query it mirrors.
 */
export async function loadSupportedPeopleFinance(userId: string): Promise<QueryResult<SupportedPersonFinance[]>> {
  const { data: grants, error: grantsError } = await supabase
    .from("profile_access")
    .select("permission_level, profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account)")
    .eq("grantee_user_id", userId);
  if (grantsError) return { ok: false, error: grantsError.message };

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

  if (people.length === 0) return { ok: true, data: [] };

  const { data: vouchers, error: vouchersError } = await supabase
    .from("care_vouchers")
    .select(
      "id, beneficiary_profile_id, purchaser_profile_id, voucher_number, sku_name, kind, status, face_value_kobo, amount_paid_kobo, redeemed_at, created_at"
    )
    .in(
      "beneficiary_profile_id",
      people.map((p) => p.profileId)
    )
    .order("created_at", { ascending: false });
  if (vouchersError) return { ok: false, error: vouchersError.message };

  const result = people.map((person) => {
    const mine = (vouchers ?? []).filter((v) => v.beneficiary_profile_id === person.profileId);

    const shape = (v: (typeof mine)[number]): SupportedPersonVoucher => ({
      id: v.id,
      voucherNumber: v.voucher_number,
      label: v.sku_name ?? (v.kind === "reward_discount" ? "Reward voucher" : "Care voucher"),
      status: v.status as SupportedPersonVoucherStatus,
      faceValueKobo: v.face_value_kobo,
      amountPaidKobo: v.amount_paid_kobo,
      redeemedAt: v.redeemed_at,
      boughtByMe: v.purchaser_profile_id === userId,
    });

    const boughtByMe = mine.filter((v) => v.purchaser_profile_id === userId);
    const fundedKobo = boughtByMe.reduce((sum, v) => sum + v.amount_paid_kobo, 0);
    const lastFunded = boughtByMe.find((v) => v.amount_paid_kobo > 0);

    return {
      profileId: person.profileId,
      fullName: person.fullName,
      permissionLevel: person.permissionLevel,
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

  return { ok: true, data: result };
}
