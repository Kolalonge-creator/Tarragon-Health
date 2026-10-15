import { describe, expect, it } from "@jest/globals";
import { GUARD_KEYS } from "@/lib/go-live/constants";
import { signoffAnchorId } from "@/lib/signoff-anchor";
import {
  attestItemKey,
  buildS06S10Rows,
  C4_CODE,
  countPendingRows,
  familyState,
  HOME_BP_GUARD,
  PATTERN_CODE,
  PATTERN_GUARD,
  PROPOSED_VALUES_ITEM_KEY,
  S06_S10_DESCRIPTORS,
  S06_S10_FOUNDER_REVIEW,
  TRIAGE_DRAFT_ITEM_KEY,
  type S06S10Facts,
} from "./s06-s10-signoff-model";

const signed = { status: "signed", panelKey: null, version: 1 } as const;
const allSigned: S06S10Facts = {
  homeBp: signed,
  prn: signed,
  myHealth: signed,
  triage: signed,
  attestations: { c4CuffWording: true, patternClinicianOnly: true },
  proposedConfirmed: {
    "bp.home_programme": true,
    "medicines.prn_limits": true,
    "medicines.adherence_report": true,
    "my_health.lock_screen_pass": true,
    "adherence.threshold": true,
  },
};

const byId = (f: S06S10Facts) => Object.fromEntries(buildS06S10Rows(f).map((r) => [r.id, r]));

describe("the S06 to S10 descriptors", () => {
  it("cover C1 to C8 once each, each with a decision, a basis and how it is signed", () => {
    expect(S06_S10_DESCRIPTORS.map((d) => d.id)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]);
    for (const d of S06_S10_DESCRIPTORS) {
      expect(d.decision.length).toBeGreaterThan(20);
      expect(d.basis.length).toBeGreaterThan(10);
      expect(d.how.length).toBeGreaterThan(10);
    }
  });
  it("uses no em dashes in staff-facing copy", () => {
    const all = JSON.stringify([S06_S10_DESCRIPTORS, S06_S10_FOUNDER_REVIEW]);
    expect(all).not.toContain("—");
  });
});

describe("buildS06S10Rows", () => {
  it("is all signed only when every source says so", () => {
    const rows = buildS06S10Rows(allSigned);
    expect(rows.every((r) => r.status === "signed")).toBe(true);
    expect(countPendingRows(rows)).toBe(0);
  });

  it("points an unsigned programme row at its hub line for C1, C2 and C3", () => {
    const r = byId({ ...allSigned, homeBp: { status: "pending", panelKey: "versioned_draft:home_bp_programme_signoffs", version: 1 } });
    for (const id of ["C1", "C2", "C3"]) {
      expect(r[id].status).toBe("pending");
      expect(r[id].panelKey).toBe("versioned_draft:home_bp_programme_signoffs");
    }
    expect(r.C4.status).toBe("signed");
  });

  it("keeps C3 pending after the programme is signed until the clinician-only attestation is recorded", () => {
    const r = byId({ ...allSigned, attestations: { c4CuffWording: true, patternClinicianOnly: false } });
    expect(r.C1.status).toBe("signed");
    expect(r.C3.status).toBe("pending");
    expect(r.C3.panelKey).toBe(attestItemKey(PATTERN_GUARD, PATTERN_CODE));
  });

  it("makes C4 depend only on the cuff wording attestation", () => {
    const r = byId({ ...allSigned, attestations: { c4CuffWording: false, patternClinicianOnly: true } });
    expect(r.C4.status).toBe("pending");
    expect(r.C4.panelKey).toBe(attestItemKey(HOME_BP_GUARD, C4_CODE));
  });

  it("points C5 at the triage draft line", () => {
    const r = byId({ ...allSigned, triage: { status: "pending", panelKey: TRIAGE_DRAFT_ITEM_KEY, version: 4 } });
    expect(r.C5.status).toBe("pending");
    expect(r.C5.panelKey).toBe(TRIAGE_DRAFT_ITEM_KEY);
  });

  it("makes C6 depend on the printed-report registry value being confirmed", () => {
    const r = byId({ ...allSigned, proposedConfirmed: { ...allSigned.proposedConfirmed, "medicines.adherence_report": false } });
    expect(r.C6.status).toBe("pending");
    expect(r.C6.panelKey).toBe(PROPOSED_VALUES_ITEM_KEY);
  });

  it("makes C6 pending again if the review trigger value stops being confirmed", () => {
    const r = byId({ ...allSigned, proposedConfirmed: { ...allSigned.proposedConfirmed, "adherence.threshold": false } });
    expect(r.C6.status).toBe("pending");
  });

  it("never reports an unreadable source as signed", () => {
    const r = byId({
      homeBp: { status: "unreadable", panelKey: null, version: null },
      prn: { status: "unreadable", panelKey: null, version: null },
      myHealth: { status: "unreadable", panelKey: null, version: null },
      triage: { status: "unreadable", panelKey: null, version: null },
      attestations: { c4CuffWording: null, patternClinicianOnly: null },
      proposedConfirmed: null,
    });
    for (const id of Object.keys(r)) expect(r[id].status).toBe("unreadable");
    expect(countPendingRows(Object.values(r))).toBe(0);
  });

  it("flags a missing row rather than hiding it", () => {
    const r = byId({ ...allSigned, prn: { status: "missing", panelKey: null, version: null } });
    expect(r.C7.status).toBe("missing");
    expect(r.C7.note).toMatch(/No row exists/);
  });

  it("anchors are stable, selector-safe ids", () => {
    expect(signoffAnchorId("versioned_draft:home_bp_programme_signoffs")).toBe("item-versioned-draft-home-bp-programme-signoffs");
    expect(signoffAnchorId(attestItemKey(HOME_BP_GUARD, C4_CODE))).toBe("item-attest-home-bp-programme-c4-cuff-wording-signed");
  });
});

describe("go-live guard keys", () => {
  it("accept every guard the attestations and the S06 to S10 items name, or the form is refused before it reaches the database", () => {
    for (const k of [HOME_BP_GUARD, PATTERN_GUARD, "prn_limits", "wallet_pass"]) {
      expect(GUARD_KEYS as readonly string[]).toContain(k);
    }
  });
});

describe("familyState", () => {
  const row = (version: number, is_active: boolean, approved_by: string | null) => ({ id: `r${version}`, version, is_active, approved_by });
  it("is pending with the draft line for an unsigned inactive v1", () => {
    expect(familyState([row(1, false, null)], "t")).toEqual({ status: "pending", panelKey: "versioned_draft:t", version: 1 });
  });
  it("is pending with the live line for a live unsigned row", () => {
    expect(familyState([row(1, true, null)], "t")).toEqual({ status: "pending", panelKey: "versioned:t", version: 1 });
  });
  it("is signed for a live signed row, and ignores an older unsigned draft", () => {
    expect(familyState([row(2, true, "s"), row(1, false, null)], "t")).toEqual({ status: "signed", panelKey: null, version: 2 });
  });
  it("offers a draft newer than the live signed row", () => {
    expect(familyState([row(1, true, "s"), row(2, false, null)], "t")).toMatchObject({ status: "pending", version: 2 });
  });
  it("treats a row with approved_at but no approved_by as signed, like the queue does", () => {
    expect(familyState([{ id: "a", version: 1, is_active: true, approved_by: null, approved_at: "2026-10-13T00:00:00Z" }], "t").status).toBe("signed");
  });
  it("is missing when there are no rows", () => {
    expect(familyState([], "t").status).toBe("missing");
  });
});
