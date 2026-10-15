import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { BASELINE_REVIEWER, checkLedger, hashText, type Ledger } from "./reviewed-ledger";
import { ledgerCandidates } from "./reviewed-strings";

const ledger = JSON.parse(readFileSync(new URL("./reviewed-strings-ledger.json", import.meta.url), "utf8")) as Ledger;
const strings = ledgerCandidates();

describe("reviewed-strings ledger (S-15): unreviewed clinical copy blocks the release build", () => {
  const report = checkLedger(strings, ledger);

  it("every clinical, emergency and consent string has a ledger entry (add one with a real reviewer and date)", () => {
    expect(report.missing).toEqual([]);
  });

  it("no string in those namespaces has changed since its ledger entry (re-review it and update the entry)", () => {
    expect(report.changed).toEqual([]);
  });

  it("entries are well formed: a reviewed entry names a real reviewer and a date, baseline entries stay baseline", () => {
    expect(report.badEntries).toEqual([]);
  });

  it("the ledger holds no entry for a string that no longer exists", () => {
    expect(report.staleEntries).toEqual([]);
  });

  it("the baseline backlog can shrink but never grow", () => {
    expect(report.baselineCount).toBeLessThanOrEqual(ledger.baselineCeiling);
  });

  it("nothing is recorded as approved by the CMO by a build", () => {
    for (const [key, e] of Object.entries(ledger.entries)) {
      expect([key, /\bCMO\b|chief medical/i.test(e.reviewer) && e.baseline]).toEqual([key, false]);
    }
  });

  it("reports the unreviewed backlog so it stays visible", () => {
    console.info(`Reviewed-strings ledger: ${report.scopeCount} strings in scope, ${report.reviewedCount} with a recorded reviewer, ${report.baselineCount} unreviewed (baseline).`);
    expect(report.baselineCount + report.reviewedCount).toBe(report.scopeCount);
  });

  describe("sabotage: the check really fails", () => {
    const someKey = Object.keys(ledger.entries).find((k) => k.startsWith("triage."))!;

    it("fails for a NEW clinical string with no entry", () => {
      const r = checkLedger({ ...strings, "triage.brand_new": "Go now." }, ledger);
      expect(r.missing).toEqual(["triage.brand_new"]);
    });

    it("fails for a CHANGED clinical string", () => {
      const r = checkLedger({ ...strings, [someKey]: strings[someKey] + " Edited." }, ledger);
      expect(r.changed).toEqual([someKey]);
    });

    it("does not fail a new string outside the namespaces", () => {
      const r = checkLedger({ ...strings, "common.something_new": "Hello" }, ledger);
      expect(r.missing).toEqual([]);
    });

    it("fails a new entry that claims 'unreviewed' or has no date, so the baseline cannot be used to skip review", () => {
      const l: Ledger = { ...ledger, entries: { ...ledger.entries, "triage.brand_new": { hash: hashText("Go now."), reviewer: BASELINE_REVIEWER, reviewedOn: null, baseline: false } } };
      const r = checkLedger({ ...strings, "triage.brand_new": "Go now." }, l);
      expect(r.badEntries.length).toBe(2);
    });

    it("passes a new string with a proper entry", () => {
      const l: Ledger = { ...ledger, entries: { ...ledger.entries, "triage.brand_new": { hash: hashText("Go now."), reviewer: "A. Reviewer", reviewedOn: "2026-10-08", baseline: false } } };
      const r = checkLedger({ ...strings, "triage.brand_new": "Go now." }, l);
      expect([r.missing, r.changed, r.badEntries]).toEqual([[], [], []]);
    });

    it("fails when a baseline entry is edited into a new baseline (the ceiling)", () => {
      const grown: Ledger = { ...ledger, baselineCeiling: ledger.baselineCeiling - 1 };
      expect(checkLedger(strings, grown).baselineCount).toBeGreaterThan(grown.baselineCeiling);
    });
  });
});
