import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * The consent-scoped family care graph, client side.
 *
 * Everything here is a thin, typed wrapper over the three RPCs added by
 * 20260807010452 / 20260807010837 / 20260807012000. No access decision is made
 * in this file, and none should be: my_care_graph and care_receipt derive the
 * caller and their consent tier from auth.uid() inside the database, so a bug
 * in this layer can render the wrong thing but cannot disclose the wrong thing.
 *
 * The RPC returns are jsonb, which the generated Supabase types surface as
 * `Json`. Each parse function below narrows that once, at the boundary, so the
 * components downstream are fully typed and nothing needs `any` (strict mode,
 * and the project bans `any` outright).
 */

// --- shared shapes -----------------------------------------------------------

export type PermissionLevel = "view" | "manage";

/** Someone who holds access to the caller's own record. */
export type PersonWithAccess = {
  grantId: string;
  profileId: string;
  name: string;
  permissionLevel: PermissionLevel;
  /** The caller has consented to this person reading their health information. */
  clinicalAccess: boolean;
  since: string;
  clinicalAccessChangedAt: string | null;
  /** They have also paid for some of the caller's care. */
  fundsMe: boolean;
  /** Last time they actually used the access, from care_access_events. */
  lastActiveAt: string | null;
};

/** A proposal nobody has answered yet, in either direction. */
export type PendingRequest = {
  requestId: string;
  permissionLevel: PermissionLevel;
  relationship: string | null;
  createdAt: string;
  aboutMyRecord: boolean;
  iInitiated: boolean;
  awaitingMe: boolean;
  otherName: string;
};

/** Someone paying for the caller's care, whether or not they hold any grant. */
export type PersonFundingMe = {
  profileId: string;
  name: string;
  totalKobo: number;
  lastPaidAt: string | null;
  fundsMyPlan: boolean;
  holdsAccess: boolean;
};

export type CareTeamNode = {
  kind: "care_team";
  revocable: false;
  assigned: boolean;
  doctorsWhoReviewedMe: number;
};

/** A record the caller can see because somebody else granted them access. */
export type RecordICanSee = {
  grantId: string;
  profileId: string;
  name: string;
  permissionLevel: PermissionLevel;
  clinicalAccess: boolean;
  isDependentAccount: boolean;
  since: string;
};

export type CareGraph = {
  peopleWithAccess: PersonWithAccess[];
  pendingRequests: PendingRequest[];
  peopleFundingMe: PersonFundingMe[];
  careTeam: CareTeamNode;
  recordsICanSee: RecordICanSee[];
};

// --- narrowing helpers -------------------------------------------------------
// The RPCs return jsonb. These read it defensively rather than casting: a
// missing key should render an empty section, never throw inside a dashboard.

type Bag = Record<string, unknown>;

function asBag(value: unknown): Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : {};
}

function asArray(value: unknown): Bag[] {
  return Array.isArray(value) ? value.map(asBag) : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

function level(value: unknown): PermissionLevel {
  return value === "manage" ? "manage" : "view";
}

function parseCareGraph(raw: unknown): CareGraph {
  const bag = asBag(raw);
  const team = asBag(bag.care_team);

  return {
    peopleWithAccess: asArray(bag.people_with_access).map((p) => ({
      grantId: str(p.grant_id),
      profileId: str(p.profile_id),
      name: str(p.name, "Someone you added"),
      permissionLevel: level(p.permission_level),
      clinicalAccess: bool(p.clinical_access),
      since: str(p.since),
      clinicalAccessChangedAt: nullableStr(p.clinical_access_changed_at),
      fundsMe: bool(p.funds_me),
      lastActiveAt: nullableStr(p.last_active_at),
    })),
    pendingRequests: asArray(bag.pending_requests).map((r) => ({
      requestId: str(r.request_id),
      permissionLevel: level(r.permission_level),
      relationship: nullableStr(r.relationship),
      createdAt: str(r.created_at),
      aboutMyRecord: bool(r.about_my_record),
      iInitiated: bool(r.i_initiated),
      awaitingMe: bool(r.awaiting_me),
      otherName: str(r.other_name, "Someone"),
    })),
    peopleFundingMe: asArray(bag.people_funding_me).map((f) => ({
      profileId: str(f.profile_id),
      name: str(f.name, "Someone"),
      totalKobo: num(f.total_kobo),
      lastPaidAt: nullableStr(f.last_paid_at),
      fundsMyPlan: bool(f.funds_my_plan),
      holdsAccess: bool(f.holds_access),
    })),
    careTeam: {
      kind: "care_team",
      revocable: false,
      assigned: bool(team.assigned),
      doctorsWhoReviewedMe: num(team.doctors_who_reviewed_me),
    },
    recordsICanSee: asArray(bag.records_i_can_see).map((o) => ({
      grantId: str(o.grant_id),
      profileId: str(o.profile_id),
      name: str(o.name, "Someone"),
      permissionLevel: level(o.permission_level),
      clinicalAccess: bool(o.clinical_access),
      isDependentAccount: bool(o.is_dependent_account),
      since: str(o.since),
    })),
  };
}

export const careGraphKey = ["care-graph"] as const;

/**
 * Every relationship around the caller's own record, in one call.
 *
 * Replaces four separate queries that each answered part of the question and
 * none of which could answer "is anyone paying for my care who I have not given
 * access to" — which had no query at all before this.
 */
export function useCareGraph() {
  return useQuery({
    queryKey: careGraphKey,
    queryFn: async (): Promise<CareGraph> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("my_care_graph");
      if (error) throw error;
      return parseCareGraph(data);
    },
  });
}

/**
 * Remove a grant. Either the record owner or the person holding the access may
 * call it — a supporter who no longer wants responsibility for a relative's
 * record no longer has to ask that relative to remove them.
 */
export function useRevokeCareAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string): Promise<{ revoked: boolean }> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("revoke_care_access", {
        p_grant_id: grantId,
      });
      if (error) throw error;
      return { revoked: bool(asBag(data).revoked) };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: careGraphKey });
      queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
      queryClient.invalidateQueries({ queryKey: ["care-access-log"] });
      queryClient.invalidateQueries({ queryKey: ["sponsorship"] });
    },
  });
}

/** Turn health visibility on or off for one person, from the graph. */
export function useSetGraphClinicalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; allow: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("profile_access")
        .update({ clinical_access: input.allow })
        .eq("id", input.grantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: careGraphKey });
      queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
      queryClient.invalidateQueries({ queryKey: ["care-access-log"] });
    },
  });
}

// --- the access log ----------------------------------------------------------

export type CareAccessEventKind =
  | "granted"
  | "permission_changed"
  | "clinical_access_granted"
  | "clinical_access_withdrawn"
  | "revoked"
  | "record_viewed"
  | "receipt_generated"
  | "acted_for";

export type CareAccessEvent = {
  id: string;
  kind: CareAccessEventKind;
  scope: string | null;
  occurredAt: string;
  actorName: string | null;
  subjectName: string | null;
};

/**
 * What has actually been done with the access this person has given out.
 *
 * RLS scopes care_access_events to rows the caller is either the subject of or
 * the actor in, so this returns the caller's own oversight and never a window
 * onto anyone else's.
 */
export function useCareAccessLog(limit = 30) {
  return useQuery({
    queryKey: ["care-access-log", limit],
    queryFn: async (): Promise<CareAccessEvent[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("care_access_events")
        .select(
          `id, kind, scope, occurred_at,
           actor:profiles!care_access_events_actor_profile_id_fkey(full_name),
           subject:profiles!care_access_events_subject_profile_id_fkey(full_name)`
        )
        .eq("patient_id", user.id)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id,
        kind: row.kind as CareAccessEventKind,
        scope: row.scope,
        occurredAt: row.occurred_at,
        actorName: row.actor?.full_name ?? null,
        subjectName: row.subject?.full_name ?? null,
      }));
    },
  });
}

// --- the receipt -------------------------------------------------------------

export type ReceiptEvent = {
  occurredAt: string;
  category: string;
  what: string;
  /** Clinical detail. Present only on a consented ('clinical') receipt. */
  detail: string | null;
  /** The doctor who actually acted, where one is recorded. Never defaulted. */
  reviewedBy: string | null;
  reviewedByCredential: string | null;
};

export type ReceiptVoucher = {
  voucherNumber: string;
  what: string | null;
  amountKobo: number;
  boughtAt: string;
  usedAt: string | null;
};

export type CareReceipt = {
  beneficiaryName: string;
  beneficiaryId: string;
  periodFrom: string;
  periodTo: string;
  /** 'activity' = proof of care only. 'clinical' = the patient has consented. */
  tier: "activity" | "clinical";
  isSelf: boolean;
  generatedAt: string;
  summary: {
    readingsRecorded: number;
    doctorReviews: number;
    testsCompleted: number;
    medicationEvents: number;
  };
  events: ReceiptEvent[];
  readingDays: { day: string; count: number }[];
  money: {
    fundedKobo: number;
    vouchersBought: number;
    vouchersUsed: number;
    vouchersWaiting: number;
    items: ReceiptVoucher[];
  };
  /** Open case counts and dates. Null on an unconsented receipt. */
  careStatus: {
    openCases: number;
    nextReviewDue: string | null;
    lastReviewedAt: string | null;
  } | null;
};

function parseReceipt(raw: unknown): CareReceipt {
  const bag = asBag(raw);
  const summary = asBag(bag.summary);
  const money = asBag(bag.money);
  const status = bag.care_status;

  return {
    beneficiaryName: str(bag.beneficiary_name, "This person"),
    beneficiaryId: str(bag.beneficiary_id),
    periodFrom: str(bag.period_from),
    periodTo: str(bag.period_to),
    tier: bag.tier === "clinical" ? "clinical" : "activity",
    isSelf: bool(bag.is_self),
    generatedAt: str(bag.generated_at),
    summary: {
      readingsRecorded: num(summary.readings_recorded),
      doctorReviews: num(summary.doctor_reviews),
      testsCompleted: num(summary.tests_completed),
      medicationEvents: num(summary.medication_events),
    },
    events: asArray(bag.events).map((e) => ({
      occurredAt: str(e.occurred_at),
      category: str(e.category, "care"),
      what: str(e.what),
      detail: nullableStr(e.detail),
      reviewedBy: nullableStr(e.reviewed_by),
      reviewedByCredential: nullableStr(e.reviewed_by_credential),
    })),
    readingDays: asArray(bag.reading_days).map((r) => ({
      day: str(r.day),
      count: num(r.count),
    })),
    money: {
      fundedKobo: num(money.funded_kobo),
      vouchersBought: num(money.vouchers_bought),
      vouchersUsed: num(money.vouchers_used),
      vouchersWaiting: num(money.vouchers_waiting),
      items: asArray(money.items).map((i) => ({
        voucherNumber: str(i.voucher_number),
        what: nullableStr(i.what),
        amountKobo: num(i.amount_kobo),
        boughtAt: str(i.bought_at),
        usedAt: nullableStr(i.used_at),
      })),
    },
    careStatus:
      typeof status === "object" && status !== null
        ? {
            openCases: num(asBag(status).open_cases),
            nextReviewDue: nullableStr(asBag(status).next_review_due),
            lastReviewedAt: nullableStr(asBag(status).last_reviewed_at),
          }
        : null,
  };
}

/**
 * Proof that the care happened.
 *
 * `from`/`to` default inside the database to the last 30 days. The tier is
 * decided there too, from the patient's live consent — passing it from the
 * client would make the disclosure boundary a UI decision, which is exactly
 * what it must never be.
 */
export function useCareReceipt(beneficiaryId: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ["care-receipt", beneficiaryId, from ?? null, to ?? null],
    queryFn: async (): Promise<CareReceipt> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("care_receipt", {
        p_beneficiary: beneficiaryId,
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (error) throw error;
      return parseReceipt(data);
    },
    enabled: Boolean(beneficiaryId),
  });
}
