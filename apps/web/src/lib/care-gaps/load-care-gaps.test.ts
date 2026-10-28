import { describe, expect, it } from "@jest/globals";
import { loadCareGaps, parseCareGapLedger, selectLedgerTypes, type CareGapLedger } from "./load-care-gaps";
import { CARE_GAP_TYPES, type CareGapType } from "./gap-model";

type Live = Extract<CareGapLedger, { live: true }>;
const cell = (key: string, n: number | null, suppressed = false) => ({ key, n, suppressed });

/** What the database publishes for an organisation whose floor is 5: one small type (2 people) withheld with its complement, the rest shown. */
const published = {
  live: true,
  min_cell: 5,
  open: {
    by_type: [
      cell("missed_reading", null, true),
      cell("no_hba1c_12_months", 0),
      cell("no_lipids_12_months", 8),
      cell("rising_bp_trend", 0),
      cell("medication_refill_lapse", null, true),
      cell("adherence_lapse", 0),
    ],
    any_people: null,
  },
  closed_90d: {
    by_type: [cell("missed_reading", null, true), cell("no_hba1c_12_months", 0), cell("no_lipids_12_months", 0), cell("rising_bp_trend", 0), cell("medication_refill_lapse", 0), cell("adherence_lapse", 0)],
    any_people: null,
    by_reason: [cell("closed", null, true), cell("declined", 0), cell("unreachable", 0), cell("wrong", 0)],
  },
};

const subsets = (): CareGapType[][] => {
  const out: CareGapType[][] = [];
  for (let m = 1; m < 1 << CARE_GAP_TYPES.length; m++) out.push(CARE_GAP_TYPES.filter((_, i) => (m >> i) & 1));
  return out;
};

describe("parseCareGapLedger", () => {
  it("reads a not-live summary as not live", () => {
    expect(parseCareGapLedger({ live: false, reason: "engine_not_live", min_cell: 5 })).toEqual({ live: false });
  });

  it("returns null for anything it cannot read, never a guessed number", () => {
    expect(parseCareGapLedger(null)).toBeNull();
    expect(parseCareGapLedger({ live: true })).toBeNull();
    expect(parseCareGapLedger({ ...published, min_cell: 0 })).toBeNull();
    expect(parseCareGapLedger({ ...published, open: { by_type: [{ key: "x", n: "7", suppressed: false }], any_people: null } })).toBeNull();
  });

  it("keeps a published grid as it is: zero shown as zero, a withheld cell with no number", () => {
    const l = parseCareGapLedger(published) as Live;
    expect(l.open.byType.find((c) => c.key === "no_lipids_12_months")).toEqual({ key: "no_lipids_12_months", n: 8, suppressed: false });
    expect(l.open.byType.find((c) => c.key === "adherence_lapse")).toEqual({ key: "adherence_lapse", n: 0, suppressed: false });
    const withheld = l.open.byType.find((c) => c.key === "missed_reading");
    expect(withheld).toEqual({ key: "missed_reading", n: null, suppressed: true });
  });

  it("withholds the total whenever any cell is withheld (the types overlap)", () => {
    const l = parseCareGapLedger({ ...published, open: { ...published.open, any_people: 12 } }) as Live;
    expect(l.open.anyPeople).toBeNull();
    const allShown = parseCareGapLedger({ ...published, open: { by_type: [cell("no_lipids_12_months", 8), cell("missed_reading", 6)], any_people: 9 } }) as Live;
    expect(allShown.open.anyPeople).toBe(9);
  });

  it("re-withholds a small number that arrives unsuppressed, and a cell that claims to be withheld but carries a number", () => {
    const l = parseCareGapLedger({
      ...published,
      open: { by_type: [cell("missed_reading", 3, false), cell("no_lipids_12_months", 9, true), cell("adherence_lapse", 7)], any_people: 19 },
    }) as Live;
    expect(l.open.byType.find((c) => c.key === "missed_reading")).toEqual({ key: "missed_reading", n: null, suppressed: true });
    expect(l.open.byType.find((c) => c.key === "no_lipids_12_months")).toEqual({ key: "no_lipids_12_months", n: null, suppressed: true });
    expect(l.open.anyPeople).toBeNull();
  });

  it("when exactly one cell is withheld a second is withheld with it, so the withheld one cannot be found by subtraction", () => {
    const l = parseCareGapLedger({
      ...published,
      open: { by_type: [cell("missed_reading", 2, true), cell("no_lipids_12_months", 8), cell("adherence_lapse", 40)], any_people: null },
    }) as Live;
    const shown = l.open.byType.filter((c) => !c.suppressed && (c.n ?? 0) > 0);
    expect(l.open.byType.filter((c) => c.suppressed)).toHaveLength(2);
    expect(shown.map((c) => c.key)).toEqual(["adherence_lapse"]);
  });

  it("ignores a cell it does not know", () => {
    const l = parseCareGapLedger({ ...published, open: { by_type: [cell("something_else", 50), cell("no_lipids_12_months", 8)], any_people: null } }) as Live;
    expect(l.open.byType.map((c) => c.key)).toEqual(["no_lipids_12_months"]);
  });
});

describe("filter combinations never reveal a withheld cell (differencing)", () => {
  const ledger = parseCareGapLedger(published) as Live;
  const floor = ledger.minCell;

  it("under every one of the 63 filter combinations every shown number is zero or at least the floor", () => {
    for (const s of subsets()) {
      const f = selectLedgerTypes(ledger, s);
      for (const c of [...f.open.byType, ...f.closed90d.byType]) {
        if (!c.suppressed) expect(c.n === 0 || (c.n ?? 0) >= floor).toBe(true);
        else expect(c.n).toBeNull();
      }
    }
  });

  it("a filter only selects cells that were already published: each cell equals the one in the unfiltered grid", () => {
    for (const s of subsets()) {
      const f = selectLedgerTypes(ledger, s);
      for (const c of f.open.byType) expect(c).toEqual(ledger.open.byType.find((x) => x.key === c.key));
      for (const c of f.closed90d.byType) expect(c).toEqual(ledger.closed90d.byType.find((x) => x.key === c.key));
      expect(f.open.anyPeople).toBe(ledger.open.anyPeople);
      expect(f.closed90d.anyPeople).toBe(ledger.closed90d.anyPeople);
    }
  });

  it("no two filters can be subtracted to reach a withheld cell: the sum of what is shown never equals a total the page also shows", () => {
    // The page shows a total only when no cell is withheld; with a withheld cell present the total is null under every filter,
    // so there is never a "total minus shown" to compute.
    for (const s of subsets()) expect(selectLedgerTypes(ledger, s).open.anyPeople).toBeNull();
    // and with nothing withheld the total equals the sum of its cells only if the cells overlap-free; it is shown but cannot isolate a hidden one
    const open = parseCareGapLedger({ ...published, open: { by_type: [cell("missed_reading", 6), cell("no_lipids_12_months", 8)], any_people: 9 } }) as Live;
    for (const s of subsets()) {
      const f = selectLedgerTypes(open, s);
      expect(f.open.byType.every((c) => !c.suppressed)).toBe(true);
    }
  });
});

describe("loadCareGaps", () => {
  function client(opts: { patients: number; gaps?: { gap_type: string; patient_id: string; opened_at: string }[]; rpc?: unknown; rpcError?: boolean }) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: Array.from({ length: opts.patients }, (_, i) => ({ id: `p${i}` })), error: null }),
          }),
          in: () => Promise.resolve({ data: opts.gaps ?? [], error: null }),
        }),
        _table: table,
      }),
      rpc: () => Promise.resolve(opts.rpcError ? { data: null, error: { message: "x" } } : { data: opts.rpc ?? { live: false }, error: null }),
    } as never;
  }

  it("returns null for a cohort below the floor, without even asking for the ledger", async () => {
    expect(await loadCareGaps(client({ patients: 3 }), "o", 10)).toBeNull();
  });

  it("returns the legacy open counts and the ledger, and no longer carries an approximated closed figure", async () => {
    const gaps = [
      { gap_type: "overdue_screening", patient_id: "p1", opened_at: "2026-10-01" },
      { gap_type: "stale_monitoring", patient_id: "p2", opened_at: "2026-10-01" },
    ];
    const s = await loadCareGaps(client({ patients: 20, gaps, rpc: published }), "o", 10);
    expect(s?.totalOpen).toBe(2);
    expect(s?.byType).toEqual({ overdue_screening: 1, stale_monitoring: 1, unactioned_abnormal: 0 });
    expect(s?.ledger?.live).toBe(true);
    expect(s).not.toHaveProperty("closedLast90Days");
  });

  it("reports the ledger as not available, never as zero, when its read fails", async () => {
    const s = await loadCareGaps(client({ patients: 20, rpcError: true }), "o", 10);
    expect(s?.ledger).toBeNull();
  });

  it("reports a not-live ledger as not live", async () => {
    const s = await loadCareGaps(client({ patients: 20, rpc: { live: false, reason: "engine_not_live", min_cell: 5 } }), "o", 10);
    expect(s?.ledger).toEqual({ live: false });
  });
});
