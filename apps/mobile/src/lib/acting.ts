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

/**
 * For an action whose table has no caregiver RLS path at all (e.g.
 * patient_pregnancy/postnatal_profiles/postnatal_checkins — a supporter's
 * write would be rejected by Postgres regardless of what this returns).
 * Refuses cleanly with `message` instead of letting the caller surface a raw
 * RLS policy-violation error through the mobile UI's generic error handling.
 * Mirrors apps/web/src/lib/acting/acting-for.ts's assertNotActingFor — call
 * this before doing the write, not after.
 *
 * Unlike web (where getActingFor's cookie read can't throw), the callers
 * here are fire-and-forget `submit()` handlers with no try/catch of their
 * own, so a rejected getActingFor() (a real SecureStore failure mode — see
 * refreshActing's own "SecureStore hiccup" comment above) would otherwise
 * propagate as an unhandled rejection, leaving the caller's loading state
 * stuck forever with no error shown — worse than the raw RLS error this
 * function exists to avoid. Same best-effort default as refreshActing:
 * treat a failed check as "not acting" rather than crash.
 */
export async function assertNotActingFor(message: string): Promise<{ error: string } | null> {
  const acting = await getActingFor().catch(() => null);
  return acting ? { error: message } : null;
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
  // A failed query must surface as an error, not as "you support nobody" —
  // the caller renders an explicit retry state instead of a false empty.
  if (error) throw error;
  if (!data) return [];

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
