import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";

const ACTING_FOR_KEY = "acting-for-profile-id-v1";

export interface ActingFor {
  profileId: string;
  fullName: string | null;
}

/**
 * Native equivalent of apps/web/src/lib/acting/acting-for.ts. Web keeps the
 * chosen beneficiary in an httpOnly cookie because every request already
 * flows through a server that can read it; the native app has no such
 * cookie jar for its bearer-authenticated calls (see webview-screen.tsx's
 * "separate cookie jar" note — a WebView's session cannot be read from
 * native code either), so the hint lives in SecureStore instead.
 *
 * Same security shape either way: the stored id is a HINT, never an
 * authority. private.can_act_for is re-checked on every read, so a stale or
 * forged value resolves back to nothing, and revoking the grant ends acting
 * on the very next check with nothing to clean up.
 */
export async function getActingFor(): Promise<ActingFor | null> {
  const beneficiaryId = await SecureStore.getItemAsync(ACTING_FOR_KEY);
  if (!beneficiaryId) return null;

  const { data: allowed } = await supabase.rpc("can_act_for", { p_beneficiary: beneficiaryId });
  if (allowed !== true) {
    await SecureStore.deleteItemAsync(ACTING_FOR_KEY);
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", beneficiaryId)
    .maybeSingle();
  if (!profile) return null;

  return { profileId: profile.id, fullName: profile.full_name };
}

/** The patient_id native screens should read/write, given who (if anyone) is
 * currently open. Mirrors resolveSubjectId on web. */
export async function resolveSubjectId(ownProfileId: string): Promise<string> {
  const acting = await getActingFor();
  return acting?.profileId ?? ownProfileId;
}

export async function startActingFor(beneficiaryId: string): Promise<boolean> {
  const { data: allowed } = await supabase.rpc("can_act_for", { p_beneficiary: beneficiaryId });
  if (allowed !== true) return false;
  await SecureStore.setItemAsync(ACTING_FOR_KEY, beneficiaryId);
  return true;
}

export async function stopActingFor(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTING_FOR_KEY);
}

export interface SupportedPerson {
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  isDependentAccount: boolean;
}

/** Mirrors useSupportedPeople's grants query in
 * apps/web/src/lib/queries/sponsorship.ts (the profile_access shape only —
 * mobile has no need for that hook's voucher/billing fields, which stay
 * WebView per docs/uploads/MOBILE_APP_SPEC.md's low-frequency/form-heavy
 * rule). Only rows granted TO this device's signed-in user. */
export async function loadPeopleISupport(userId: string): Promise<SupportedPerson[]> {
  const { data, error } = await supabase
    .from("profile_access")
    .select(
      "permission_level, profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account)"
    )
    .eq("grantee_user_id", userId);
  if (error || !data) return [];

  return data.flatMap((row) => {
    const profile = row.profile;
    if (!profile) return [];
    return [
      {
        profileId: profile.id,
        fullName: profile.full_name,
        permissionLevel: row.permission_level,
        isDependentAccount: profile.is_dependent_account === true,
      },
    ];
  });
}
