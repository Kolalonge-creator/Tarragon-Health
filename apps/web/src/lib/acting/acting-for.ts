import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const COOKIE = "th_acting_for";

export type ActingFor = {
  profileId: string;
  fullName: string | null;
};

/**
 * Who the caller currently has open, if anyone.
 *
 * The cookie is a HINT, never an authority. Every call re-checks the live
 * 'manage' grant through private.can_act_for, so:
 *
 *  - a forged or copied cookie gets nothing, because the grant is what is
 *    actually checked;
 *  - revoking the grant ends the access on the very next request, with no
 *    session to expire and nothing to clean up;
 *  - a downgrade from 'manage' to 'view' ends it too.
 *
 * This is also why acting-for is not impersonation. auth.uid() remains the
 * supporter throughout — every RLS policy on this platform is built on that,
 * and a session that lied about who was calling would quietly undermine all of
 * them at once. Only the patient_id the app is pointed at changes.
 */
export async function getActingFor(): Promise<ActingFor | null> {
  const jar = await cookies();
  const beneficiaryId = jar.get(COOKIE)?.value;
  if (!beneficiaryId) return null;

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_act_for", {
    p_beneficiary: beneficiaryId,
  });
  if (allowed !== true) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", beneficiaryId)
    .maybeSingle();
  if (!profile) return null;

  return { profileId: profile.id, fullName: profile.full_name };
}

/**
 * The patient_id the current page should be about.
 *
 * Everything a supporter writes while acting is stamped with their own
 * identity by private.stamp_acting_supporter, from auth.uid() rather than from
 * anything sent by the client — so pointing the app at somebody else's record
 * can never make an entry look like that person's own account of themselves.
 */
export async function resolveSubjectId(ownProfileId: string): Promise<string> {
  const acting = await getActingFor();
  return acting?.profileId ?? ownProfileId;
}

export async function startActingFor(beneficiaryId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_act_for", {
    p_beneficiary: beneficiaryId,
  });
  if (allowed !== true) return false;

  const jar = await cookies();
  jar.set(COOKIE, beneficiaryId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Deliberately short. Opening somebody's account is something you do to
    // run an errand, not a mode to live in, and it should not survive quietly
    // in a browser for weeks.
    maxAge: 60 * 60 * 2,
  });
  return true;
}

export async function stopActingFor(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
