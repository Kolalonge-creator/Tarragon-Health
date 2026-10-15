/**
 * The S06 to S10 clinical items the Chief Medical Officer owes a decision on (C1 to C8 of
 * docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md, answers recorded 2026-10-07 in
 * docs/plans/S06-S10-cmo-decisions-2026-10-07.md), joined to the live state of whatever carries each one.
 *
 * Pure on purpose (no server-only import, no database): the reader in lib/queries/s06-s10-signoffs.ts gathers the
 * facts, this file turns them into the rows the hub banner shows, so the wording and the status rules can be tested.
 *
 * Nothing here signs anything. Each row only says what the item is, what was decided, how well its guideline basis
 * was read, whether it is signed, and which hub line to open.
 */

export type S06S10Status = "pending" | "signed" | "missing" | "unreadable";

/** The state of one versioned row family (home BP programme, as-needed limits, My Health config). */
export type RowFamilyState = {
  status: S06S10Status;
  /** The hub queue key of the line that carries the Sign control, when there is something to sign. */
  panelKey: string | null;
  version: number | null;
  /** For the triage rule set: the version currently approved (stays in force until the draft is signed). */
  approvedVersion?: number | null;
  /** For the triage rule set: the draft's own note, quoted in the hub line instead of a hand-written summary. */
  note?: string | null;
};

export type S06S10Facts = {
  homeBp: RowFamilyState;
  prn: RowFamilyState;
  myHealth: RowFamilyState;
  /** bp_care_triage: the newest draft is signable when it is newer than the approved version. */
  triage: RowFamilyState;
  /** Go-live condition attestations the CMO records; null when the guard could not be read. */
  attestations: { c4CuffWording: boolean | null; patternClinicianOnly: boolean | null };
  /** Registry key to whether the CMO has confirmed its current version; null when the sign-offs could not be read. */
  proposedConfirmed: Record<string, boolean> | null;
};

export type VersionRow = { id: string; version: number; is_active: boolean; approved_by: string | null; approved_at?: string | null };

const isSignedRow = (r: VersionRow) => (r.approved_by ?? r.approved_at ?? null) !== null;

/**
 * Pending, signed or missing for a table that follows the shared (version, is_active, approved_by) shape. Mirrors the queue's own rule:
 * a live unsigned row is signable, and so is the newest unsigned draft that is newer than the live signed one. An older draft is history.
 */
export function familyState(rows: VersionRow[], table: string): RowFamilyState {
  const signedLive = rows.find((r) => r.is_active && isSignedRow(r)) ?? null;
  const liveUnsigned = rows.find((r) => r.is_active && !isSignedRow(r)) ?? null;
  if (liveUnsigned) return { status: "pending", panelKey: `versioned:${table}`, version: liveUnsigned.version };
  const draft = rows
    .filter((r) => !r.is_active && !isSignedRow(r) && r.version > (signedLive?.version ?? 0))
    .sort((a, b) => b.version - a.version)[0];
  if (draft) return { status: "pending", panelKey: `versioned_draft:${table}`, version: draft.version };
  if (signedLive) return { status: "signed", panelKey: null, version: signedLive.version };
  return { status: "missing", panelKey: null, version: null };
}

export const HOME_BP_GUARD = "home_bp_programme";
export const PATTERN_GUARD = "bp_pattern_flag";
export const C4_CODE = "c4_cuff_wording_signed";
export const PATTERN_CODE = "pattern_is_clinician_only";

export const ATTEST_ITEM_PREFIX = "attest:";
export const attestItemKey = (guard: string, code: string) => `${ATTEST_ITEM_PREFIX}${guard}:${code}`;
export const TRIAGE_DRAFT_ITEM_KEY = "triage_rule_set_draft";
export const PROPOSED_VALUES_ITEM_KEY = "proposed_values_s06_s10";

/** Registry values the Chief Medical Officer owns that these items put in front of them. */
export const S06_S10_CMO_PROPOSED_KEYS = [
  "bp.home_programme",
  "medicines.prn_limits",
  "medicines.adherence_report",
  "my_health.lock_screen_pass",
  // The review trigger half of C6, confirmed 2026-10-07. Read so the C6 row reflects the live state: if that value ever changes it needs confirming again.
  "adherence.threshold",
] as const;

/** Values from the same build the founder owns. Shown for review; the Chief Medical Officer account cannot confirm them. */
export const S06_S10_FOUNDER_REVIEW: ReadonlyArray<{ key: string; title: string; what: string }> = [
  {
    key: "events.bus_rules",
    title: "Event bus retry, lag alert and partner auto-disable values",
    what: "S10x: alert when a subscriber falls 10 minutes behind, and switch a partner webhook off after 20 failures in a row.",
  },
  {
    key: "offline.trust",
    title: "Offline trust values",
    what: "S06x: 30-day device key lease, 60-second reachability probe, 24-hour grace before a wipe, 200 rejection reports a day.",
  },
  {
    key: "my_health.sharing_and_access_log",
    title: "My Health sharing and access-log values",
    what: "S09x: 12-hour default share expiry, 6-digit PIN, 5 wrong PINs lock a share. Needs counsel (D9).",
  },
];

export type S06S10Descriptor = {
  id: string;
  title: string;
  /** The decision recorded 2026-10-07, in the CMO's own terms. */
  decision: string;
  /** Guideline basis, short, with how well it was read. */
  basis: string;
  /** What signs it, in words a non-engineer can follow. */
  how: string;
};

export const S06_S10_DESCRIPTORS: readonly S06S10Descriptor[] = [
  {
    id: "C1",
    title: "Home blood pressure check protocol",
    decision:
      "Approved as written: 7-day target, at least 3 days and 12 readings, every reading averaged. A \"complete\" average only at 12 or more readings over 3 or more days; below that the screen says \"not enough readings yet\".",
    basis: "Nigeria 2023-2028 guideline sections 3.1.1, 5.4.5, 3.2 (read in full). ESH 2023 and AHA/ACC 2025 from summaries: re-check.",
    how: "Sign the Home blood pressure programme row (one signature covers C1, C2 and C3).",
  },
  {
    id: "C2",
    title: "Home blood pressure bands",
    decision:
      "Approved as written: 135/85 and above is above the home level; 130-134 / 80-84 is borderline; below 130/80 is within target. A clinician sets a personal target. Never the word \"uncontrolled\".",
    basis: "Nigeria 2023-2028 out-of-office table and target (read). ESH 2023 and ISH 2020: the borderline band is from a summary, re-check.",
    how: "Same signature as C1.",
  },
  {
    id: "C3",
    title: "White-coat and masked pattern rule",
    decision:
      "Approved for all adults with a clinic reading and a complete protocol within 30 days. A routine clinician-only task, never shown to the patient, never in a notification, never changes a medicine.",
    basis: "Nigeria 2023-2028 sections 6.2, 6.3, 3.2 (read in full). ESH 2023 from a summary.",
    how: "Same signature as C1, then record that the flag is clinician-only (the attestation on the Pattern flag guard).",
  },
  {
    id: "C4",
    title: "Cuff and measurement guidance wording",
    decision:
      "Approved as written, including the battery-cuff advice (labelled practical advice, not a guideline rule). Validated upper-arm device, cuff fit, same arm, no wrist or finger devices, validated for pregnancy.",
    basis: "Nigeria 2023-2028 sections 3.1, 3.1.1, 6.4 (read in full). AHA/ACC 2025 on cuffless devices from a summary. Battery advice is a practical Nigerian judgement.",
    how: "Record the wording attestation on the Home blood pressure programme guard. Nothing is switched on.",
  },
  {
    id: "C5",
    title: "Low blood pressure without symptoms",
    decision:
      "Approved: an amber 24-hour care-team review for a systolic below 90 in a patient taking blood pressure medicines. Emergency lines with symptoms are unchanged.",
    basis: "No guideline line exists for an asymptomatic low home reading. This is clinical judgement, recorded as yours.",
    how: "Sign the blood pressure triage rule set draft (tick the box and type SIGN).",
  },
  {
    id: "C6",
    title: "Medicine adherence display and review trigger",
    decision:
      "Approved as written: weekly adherence from doses marked taken, only with 3 or more doses due, as-needed left out; a review task (never an alarm) below 80% for 2 weeks running or 3 critical doses missed in a row.",
    basis: "WHO 2003; Nigeria 2023-2028 section 5.4.5 (read). The 80% line is a population convention, not a clinical cut-off.",
    how: "Confirm the review trigger (adherence.threshold) and the printed report value (medicines.adherence_report) in the proposed values list. A value already confirmed shows as done.",
  },
  {
    id: "C7",
    title: "As-needed medicine limits and interaction wording",
    decision:
      "Approved as written: clinician-set limits per medicine, no defaults, warn but never block, three alert tiers, \"not checked\" for unlisted medicines. The interaction checker stays off until a signed dataset exists.",
    basis: "Not guideline-grounded. Your call with a pharmacist; Apple's three-tier scheme and AHRQ alert-fatigue evidence from summaries.",
    how: "Sign the As-needed medicine limits row. The pharmacist review is a separate condition on its go-live guard.",
  },
  {
    id: "C8",
    title: "Lock-screen pass fields",
    decision:
      "Approved as written: initials, blood group, genotype with its provenance badge, \"allergies on file\", the emergency contact's phone, and an unlock hint. Off by default (D4). Nothing else on a lock screen.",
    basis: "Privacy judgement; NDPA 2023 basis is for counsel (D9). Sickle-cell relevance noted; the national guideline was not retrieved.",
    how: "Sign the My Health lock-screen pass fields row. The pass stays inert until Apple and Google credentials exist and the Wallet pass guard is on.",
  },
];

export type S06S10Row = S06S10Descriptor & {
  status: S06S10Status;
  /** Hub queue key of the line to open (the page turns it into an anchor), or null when nothing is waiting there. */
  panelKey: string | null;
  /** Where to go when there is no hub line (signed items, or a mechanism that lives on another page). */
  fallbackHref: string;
  /** One honest line about the state, shown beside the badge. */
  note: string;
};

function worst(...states: S06S10Status[]): S06S10Status {
  for (const s of ["unreadable", "missing", "pending"] as const) if (states.includes(s)) return s;
  return "signed";
}

function fromAttestation(met: boolean | null): S06S10Status {
  return met === null ? "unreadable" : met ? "signed" : "pending";
}

function fromConfirmed(map: Record<string, boolean> | null, key: string): S06S10Status {
  if (map === null) return "unreadable";
  return map[key] ? "signed" : "pending";
}

/** Joins the static descriptors to the live facts. Pure, so the status rules are testable without a database. */
export function buildS06S10Rows(f: S06S10Facts): S06S10Row[] {
  const programme = f.homeBp.status;
  const c3 = worst(programme, fromAttestation(f.attestations.patternClinicianOnly));
  const c4 = fromAttestation(f.attestations.c4CuffWording);
  const c6 = worst(fromConfirmed(f.proposedConfirmed, "medicines.adherence_report"), fromConfirmed(f.proposedConfirmed, "adherence.threshold"));
  const c7 = f.prn.status;
  const c8 = f.myHealth.status;

  const status: Record<string, S06S10Status> = { C1: programme, C2: programme, C3: c3, C4: c4, C5: f.triage.status, C6: c6, C7: c7, C8: c8 };
  const panel: Record<string, string | null> = {
    C1: f.homeBp.panelKey,
    C2: f.homeBp.panelKey,
    C3: f.homeBp.panelKey ?? (fromAttestation(f.attestations.patternClinicianOnly) === "pending" ? attestItemKey(PATTERN_GUARD, PATTERN_CODE) : null),
    C4: c4 === "pending" ? attestItemKey(HOME_BP_GUARD, C4_CODE) : null,
    C5: f.triage.panelKey,
    C6: c6 === "pending" ? PROPOSED_VALUES_ITEM_KEY : null,
    C7: f.prn.panelKey,
    C8: f.myHealth.panelKey,
  };
  const fallback: Record<string, string> = {
    C1: "/clinician/home-bp-programme",
    C2: "/clinician/home-bp-programme",
    C3: "/clinician/go-live#bp_pattern_flag",
    C4: "/clinician/go-live#home_bp_programme",
    C5: "/clinician/triage-rules",
    C6: "/clinician/go-live#medicines.adherence_report",
    C7: "/clinician/prn-limit-rules",
    C8: "/clinician/my-health-config",
  };

  return S06_S10_DESCRIPTORS.map((d) => {
    const s = status[d.id] ?? "unreadable";
    let note: string;
    if (s === "signed") note = "Signed.";
    else if (s === "pending") note = "Waiting for your signature.";
    else if (s === "missing") note = "No row exists to sign. This needs an engineer.";
    else note = "Could not be read just now. Not an all-clear: reload.";
    if (d.id === "C3" && s === "pending" && programme === "signed") note = "Waiting for your attestation that the flag is clinician-only.";
    if (d.id === "C8" && s === "signed" && f.proposedConfirmed && !f.proposedConfirmed["my_health.lock_screen_pass"]) {
      note = "Signed. The registry copy of the same value (my_health.lock_screen_pass) can be confirmed in the proposed values list.";
    }
    return { ...d, status: s, panelKey: panel[d.id] ?? null, fallbackHref: fallback[d.id] ?? "/clinician/clinical-signoff", note };
  });
}

/** How many of the rows still need the Chief Medical Officer. */
export function countPendingRows(rows: readonly S06S10Row[]): number {
  return rows.filter((r) => r.status === "pending").length;
}
