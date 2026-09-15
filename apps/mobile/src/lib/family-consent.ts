import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums } from "@tarragon/shared";

/**
 * Family's `profile_id = me` direction — who can see/act on the caller's OWN
 * record: next-of-kin nomination, the accept/decline request flow, the
 * emergency-access-on-my-record banner, and per-category care visibility.
 * This is the genuinely new half of Family — the opposite direction from
 * acting.ts's loadPeopleISupport (`grantee_user_id = me`, already native via
 * supporting-screen.tsx). Mirrors apps/web/.../patient/family/
 * care-access-actions.ts + lib/queries/{care-access,emergency-access}.ts.
 * Every write here is a plain RLS-scoped call or an existing RPC already
 * safe to call directly — no service role, no new access-control shape. See
 * docs/mobile-native-conversion/family.md's safety flags before changing
 * anything, especially the E.164 phone regex and the
 * reproductive_health-stays-separate rule below.
 */

export const NEXT_OF_KIN_RELATIONSHIPS = ["spouse", "child", "parent", "sibling", "other"] as const;
export type NextOfKinRelationship = (typeof NEXT_OF_KIN_RELATIONSHIPS)[number];

const PHONE_REGEX = /^\+\d{10,15}$/;

export interface NextOfKinState {
  name: string | null;
  phone: string | null;
  relationship: string | null;
  /** id of the profile_access grant, once the next of kin has accepted. */
  grantId: string | null;
  /** id of the pending care_access_requests row, while waiting on them. */
  pendingRequestId: string | null;
}

export async function loadNextOfKin(patientId: string): Promise<QueryResult<NextOfKinState>> {
  const [{ data: me, error: meError }, { data: grants, error: grantsError }, { data: requests, error: requestsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("emergency_contact_name, emergency_contact_phone, emergency_contact_relationship")
        .eq("id", patientId)
        .maybeSingle(),
      supabase
        .from("profile_access")
        .select("id, permission_level, created_at")
        .eq("profile_id", patientId)
        .order("created_at", { ascending: true }),
      supabase
        .from("care_access_requests")
        .select("id, profile_id, initiated_by, permission_level")
        .eq("profile_id", patientId)
        .eq("initiated_by", patientId)
        .eq("permission_level", "view")
        .eq("status", "pending"),
    ]);
  if (meError) return { ok: false, error: meError.message };
  if (grantsError) return { ok: false, error: grantsError.message };
  if (requestsError) return { ok: false, error: requestsError.message };

  const viewGrant = (grants ?? []).find((g) => g.permission_level === "view") ?? null;
  const pendingRequest = (requests ?? [])[0] ?? null;

  return {
    ok: true,
    data: {
      name: me?.emergency_contact_name ?? null,
      phone: me?.emergency_contact_phone ?? null,
      relationship: me?.emergency_contact_relationship ?? null,
      grantId: viewGrant?.id ?? null,
      pendingRequestId: pendingRequest?.id ?? null,
    },
  };
}

/**
 * Mirrors nominateNextOfKinAction: always records contactability on the
 * caller's own profiles row (works even if the number has no Tarragon
 * account), then — only if the phone resolves to a real, different account
 * — creates a pending view request via request_care_access, which takes a
 * PHONE NUMBER, never a profile id (private.guard_care_access_request_insert
 * refuses a direct id insert). Never silently overwrites an existing grant
 * or pending request — checks both first, same as web.
 */
export async function nominateNextOfKin(
  patientId: string,
  input: { full_name: string; phone: string; relationship: NextOfKinRelationship }
): Promise<QueryResult<string>> {
  const fullName = input.full_name.trim();
  if (fullName.length < 2) return { ok: false, error: "Enter their full name" };
  const phone = input.phone.trim();
  if (!PHONE_REGEX.test(phone)) return { ok: false, error: "Use the international format, e.g. +2348012345678" };

  const { error: contactError } = await supabase
    .from("profiles")
    .update({
      emergency_contact_name: fullName,
      emergency_contact_phone: phone,
      emergency_contact_relationship: input.relationship,
      emergency_contact_consent: true,
      emergency_contact_consent_at: new Date().toISOString(),
    })
    .eq("id", patientId);
  if (contactError) return { ok: false, error: contactError.message };

  const { data: found } = await supabase.rpc("find_profile_by_phone", { lookup_phone: phone }).maybeSingle();

  if (!found || found.id === patientId) {
    return {
      ok: true,
      data: `${fullName} is now your next of kin. We'll contact them if something urgent comes up. They don't have a Tarragon account on that number yet, so there's nothing for them to view yet: add them again once they sign up and they'll be able to follow your care.`,
    };
  }

  const { data: existingGrant } = await supabase
    .from("profile_access")
    .select("id")
    .eq("profile_id", patientId)
    .eq("grantee_user_id", found.id)
    .maybeSingle();
  if (existingGrant) {
    return { ok: true, data: `${fullName} is now your next of kin. They can already see your care activity.` };
  }

  const { data: existingRequest } = await supabase
    .from("care_access_requests")
    .select("id")
    .eq("profile_id", patientId)
    .eq("counterparty_user_id", found.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existingRequest) {
    return {
      ok: true,
      data: `${fullName} is now your next of kin. We already asked them to confirm before they can see your care activity, waiting on them.`,
    };
  }

  const { error: requestError } = await supabase.rpc("request_care_access", {
    p_phone: phone,
    p_permission_level: "view",
    p_direction: "offer_my_record",
    p_relationship: input.relationship,
    p_permissions: null,
    p_expires_at: null,
  });
  // A duplicate proposal is not a failure — the nomination still stands.
  if (requestError && requestError.code !== "23505") {
    return { ok: false, error: requestError.message };
  }

  return {
    ok: true,
    data: `${fullName} is now your next of kin. We've asked them to confirm before they can see your care activity; they'll get a notification and can accept any time.`,
  };
}

/** Withdraws someone's view of the caller's own record. RLS scopes DELETE to
 * profile_id = auth.uid(), so this can never remove a rival grantee. */
export async function revokeCareAccess(grantId: string, patientId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.from("profile_access").delete().eq("id", grantId).eq("profile_id", patientId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Withdraws a request the caller sent before the other party responded.
 * private.guard_care_access_request_update (BEFORE UPDATE trigger) is the
 * real control on what may change — this only sets status. */
export async function cancelCareAccessRequest(requestId: string, patientId: string): Promise<QueryResult<null>> {
  const { error } = await supabase
    .from("care_access_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("initiated_by", patientId)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Pending accept/decline requests (both directions at once)
// ---------------------------------------------------------------------------

export interface CareAccessRequestRow {
  id: string;
  profile_id: string;
  counterparty_user_id: string;
  initiated_by: string;
  permission_level: "view" | "manage";
  relationship: string | null;
  created_at: string;
  owner_name: string | null;
  counterparty_name: string | null;
}

const RELATIONSHIP_INVERSE: Record<string, string> = {
  parent: "child",
  child: "parent",
  grandparent: "grandchild",
  grandchild: "grandparent",
  spouse: "spouse",
  sibling: "sibling",
  other: "other",
};

export function inverseRelationship(relationship: string): string {
  return RELATIONSHIP_INVERSE[relationship] ?? relationship;
}

/** Every still-pending care_access_requests row involving the caller,
 * either side — RLS already scopes this to rows where profile_id or
 * counterparty_user_id = the caller. */
export async function loadCareAccessRequests(patientId: string): Promise<CareAccessRequestRow[]> {
  const { data } = await supabase
    .from("care_access_requests")
    .select(
      "id, profile_id, counterparty_user_id, initiated_by, permission_level, relationship, created_at, owner:profiles!care_access_requests_profile_id_fkey(full_name), counterparty:profiles!care_access_requests_counterparty_user_id_fkey(full_name)"
    )
    .or(`profile_id.eq.${patientId},counterparty_user_id.eq.${patientId}`)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return (data ?? []).map((r) => ({
    id: r.id,
    profile_id: r.profile_id,
    counterparty_user_id: r.counterparty_user_id,
    initiated_by: r.initiated_by,
    permission_level: r.permission_level,
    relationship: r.relationship,
    created_at: r.created_at,
    owner_name: r.owner?.full_name ?? null,
    counterparty_name: r.counterparty?.full_name ?? null,
  }));
}

/** Accepts or declines a pending request. All validation happens inside
 * respond_to_care_access_request (SECURITY DEFINER) — the owner-offers
 * direction needs the counterparty to accept, a write RLS can't express
 * directly. Nothing here is trusted beyond "call the RPC." */
export async function respondToCareAccessRequest(requestId: string, accept: boolean): Promise<QueryResult<string>> {
  const { error } = await supabase.rpc("respond_to_care_access_request", { p_request_id: requestId, p_accept: accept });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: accept ? "Accepted. That access is active now." : "Declined. No access was given." };
}

// ---------------------------------------------------------------------------
// Emergency access on my own record
// ---------------------------------------------------------------------------

export interface EmergencyGrantOnMyRecord {
  id: string;
  granteeName: string | null;
  reason: string;
  expiresAt: string;
}

function isActive(g: { expiresAt: string; revokedAt: string | null }): boolean {
  return g.revokedAt === null && new Date(g.expiresAt) > new Date();
}

export async function loadEmergencyGrantsOnMyRecord(patientId: string): Promise<EmergencyGrantOnMyRecord[]> {
  const { data } = await supabase
    .from("emergency_access_grants")
    .select(
      "id, reason, expires_at, revoked_at, grantee:profiles!emergency_access_grants_grantee_user_id_fkey(full_name)"
    )
    .eq("profile_id", patientId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });

  return (data ?? [])
    .map((row) => ({ id: row.id, granteeName: row.grantee?.full_name ?? null, reason: row.reason, expiresAt: row.expires_at, revokedAt: row.revoked_at }))
    .filter(isActive)
    .map(({ id, granteeName, reason, expiresAt }) => ({ id, granteeName, reason, expiresAt }));
}

export async function revokeEmergencyAccess(grantId: string, patientId: string): Promise<QueryResult<null>> {
  const { error } = await supabase
    .from("emergency_access_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: patientId })
    .eq("id", grantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Care visibility — per-category clinical read access, `profile_id = me`
// direction. reproductive_health is deliberately excluded from
// CARE_ACCESS_CATEGORIES and rendered as its own separate, never-bundled
// toggle, per CLAUDE.md's standing rule on this access category.
// ---------------------------------------------------------------------------

export type CareAccessCategory = Enums<"care_access_category">;

export const CARE_ACCESS_CATEGORIES: { value: CareAccessCategory; label: string }[] = [
  { value: "appointments_care_plan", label: "Appointments and care plan" },
  { value: "vitals_readings", label: "Readings (blood pressure, glucose, weight...)" },
  { value: "medications", label: "Medications" },
  { value: "labs_results", label: "Lab and screening results" },
  { value: "vaccinations", label: "Vaccinations" },
  { value: "messaging", label: "Messages with the care team" },
  { value: "medical_history", label: "Medical history (heart, blood, past reports)" },
];

export interface CareFollower {
  grantId: string;
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  categories: CareAccessCategory[];
  since: string;
  expiresAt: string | null;
}

/** The people who can see the caller's own record — the list the category
 * checkboxes hang off. Mirrors useMyCareFollowers. */
export async function loadMyCareFollowers(patientId: string): Promise<CareFollower[]> {
  const { data, error } = await supabase
    .from("profile_access")
    .select(
      "id, permission_level, created_at, expires_at, grantee:profiles!profile_access_grantee_user_id_fkey(id, full_name), categories:profile_access_categories(category)"
    )
    .eq("profile_id", patientId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    if (!row.grantee) return [];
    return [
      {
        grantId: row.id,
        profileId: row.grantee.id,
        fullName: row.grantee.full_name,
        permissionLevel: row.permission_level as "view" | "manage",
        categories: (row.categories ?? []).map((c) => c.category as CareAccessCategory),
        since: row.created_at,
        expiresAt: row.expires_at,
      },
    ];
  });
}

/** Sets exactly which categories one grantee can see — a single RPC that
 * diffs and applies both sides atomically. private.enforce_category_access_owner
 * refuses this to anyone but the record owner regardless, so there's no
 * privileged path to guard client-side. */
export async function setCareAccessCategories(grantId: string, categories: CareAccessCategory[]): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("set_care_access_categories", { p_grant_id: grantId, p_categories: categories });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Activity log — "what's happened with your access", both directions at once
// ---------------------------------------------------------------------------

export type CareAccessEventKind =
  | "granted"
  | "permission_changed"
  | "clinical_access_granted"
  | "clinical_access_withdrawn"
  | "revoked"
  | "record_viewed"
  | "receipt_generated"
  | "acted_for"
  | "expired"
  | "data_exported"
  | "category_access_granted"
  | "category_access_withdrawn";

export interface CareAccessLogRow {
  id: string;
  kind: CareAccessEventKind;
  occurredAt: string;
  isAboutMe: boolean;
  actorIsMe: boolean;
  patientName: string | null;
  actorName: string | null;
  subjectName: string | null;
}

/** Grant-lifecycle events, most recent first, capped at 30 — same cap as
 * web. RLS already scopes rows to the caller (their own record, or actions
 * they themselves took), so no extra client-side filter is needed beyond
 * the isAboutMe/actorIsMe flags used for the copy. Mirrors the
 * care_access_events read in family/page.tsx + care-access-log.tsx's own
 * describe(). */
export async function loadCareAccessLog(patientId: string): Promise<CareAccessLogRow[]> {
  const { data } = await supabase
    .from("care_access_events")
    .select(
      "id, kind, occurred_at, patient_id, actor_profile_id, patient:profiles!care_access_events_patient_id_fkey(full_name), actor:profiles!care_access_events_actor_profile_id_fkey(full_name), subject:profiles!care_access_events_subject_profile_id_fkey(full_name)"
    )
    .order("occurred_at", { ascending: false })
    .limit(30);

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind as CareAccessEventKind,
    occurredAt: row.occurred_at,
    isAboutMe: row.patient_id === patientId,
    actorIsMe: row.actor_profile_id === patientId,
    patientName: row.patient?.full_name ?? null,
    actorName: row.actor?.full_name ?? null,
    subjectName: row.subject?.full_name ?? null,
  }));
}

/** Ported verbatim from care-access-log.tsx's describe() so the same event
 * reads as the same sentence on both platforms. */
export function describeCareAccessEvent(row: CareAccessLogRow): string {
  const actor = row.actorIsMe ? "You" : (row.actorName ?? "Someone");
  const subject = row.subjectName ?? "someone";
  const patient = row.patientName ?? "their record";

  if (row.isAboutMe) {
    switch (row.kind) {
      case "granted":
        return `${actor} gave ${subject} access to your record`;
      case "revoked":
        return `${actor} removed ${subject}'s access to your record`;
      case "clinical_access_granted":
        return `You let ${subject} see your health information`;
      case "clinical_access_withdrawn":
        return `You stopped ${subject} seeing your health information`;
      case "category_access_granted":
        return `You shared more of your health information with ${subject}`;
      case "category_access_withdrawn":
        return `You shared less of your health information with ${subject}`;
      case "permission_changed":
        return `${subject}'s access to your record changed`;
      case "receipt_generated":
        return `A care receipt was generated for ${subject}`;
      case "data_exported":
        return `${actor} exported data from your record`;
      case "record_viewed":
        return `${actor} viewed your record`;
      case "acted_for":
        return `${actor} acted on your behalf`;
      default:
        return "Something changed on your record";
    }
  }

  switch (row.kind) {
    case "revoked":
      return row.actorIsMe ? `You removed your own access to ${patient}` : `Your access to ${patient} was removed`;
    case "receipt_generated":
      return `You generated a care receipt for ${patient}`;
    case "data_exported":
      return `You exported data from ${patient}`;
    case "record_viewed":
      return `You viewed ${patient}`;
    case "acted_for":
      return `You acted on behalf of ${patient}`;
    default:
      return `Something changed on ${patient}`;
  }
}
