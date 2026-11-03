import { describe, expect, it } from "@jest/globals";
import type { AddCheckFinding } from "./add-check";
import { mergeAddFindings } from "./add-check-merge";

type Sev = AddCheckFinding["severity"];
const s53 = (severity: Sev, names: string[]): AddCheckFinding => ({
  kind: "interaction", severity, drugNames: names, adviceKey: severity === "contraindicated" ? "medicines.addcheck.advice.high" : "medicines.addcheck.advice.review",
});
const rule = (severity: Sev, names: [string, string]): AddCheckFinding => ({
  kind: "rule", severity, drugNames: names, adviceKey: severity === "contraindicated" ? "medicines.rules.advice.high" : "medicines.rules.advice.review",
});
const dup: AddCheckFinding = { kind: "duplicate", severity: "contraindicated", drugNames: ["Amlodipine", "Norvasc"], adviceKey: "medicines.addcheck.advice.duplicate" };
const same: AddCheckFinding = { kind: "same_ingredient", severity: "caution", drugNames: ["Norvasc", "Amlodipine"], adviceKey: "medicines.addcheck.advice.same_ingredient" };

describe("mergeAddFindings", () => {
  it("returns nothing for nothing and leaves a lone finding alone", () => {
    expect(mergeAddFindings([], "Ibuprofen")).toEqual([]);
    const only = s53("caution", ["Lisinopril", "Ibuprofen"]);
    expect(mergeAddFindings([only], "Ibuprofen")).toEqual([only]);
    const lone = rule("caution", ["Ibuprofen", "Lisinopril"]);
    expect(mergeAddFindings([lone], "Ibuprofen")).toEqual([lone]);
  });
  it("keeps one interaction warning per pair when the class dataset and the rule set both fire, preferring the cited rule on a tie", () => {
    const a = s53("contraindicated", ["Lisinopril", "Losartan"]);
    const b = rule("contraindicated", ["Losartan", "Lisinopril"]);
    expect(mergeAddFindings([a, b], "Losartan")).toEqual([b]);
    expect(mergeAddFindings([b, a], "Losartan")).toEqual([b]);
  });
  it("keeps the more severe finding whichever check produced it", () => {
    const classHigh = s53("contraindicated", ["Warfarin", "Ibuprofen"]);
    const ruleReview = rule("caution", ["Ibuprofen", "Warfarin"]);
    expect(mergeAddFindings([ruleReview, classHigh], "Ibuprofen")).toEqual([classHigh]);
    const classReview = s53("caution", ["Warfarin", "Ibuprofen"]);
    const ruleHigh = rule("contraindicated", ["Ibuprofen", "Warfarin"]);
    expect(mergeAddFindings([classReview, ruleHigh], "Ibuprofen")).toEqual([ruleHigh]);
  });
  it("matches a pair by name regardless of case, punctuation and order", () => {
    const a = s53("caution", ["Lisinopril 10mg", "Ibuprofen"]);
    const b = rule("caution", ["ibuprofen", "LISINOPRIL-10MG"]);
    expect(mergeAddFindings([a, b], " Ibuprofen ")).toEqual([b]);
  });
  it("never merges findings about different pairs", () => {
    const a = s53("caution", ["Lisinopril", "Ibuprofen"]);
    const b = rule("caution", ["Ibuprofen", "Spironolactone"]);
    expect(mergeAddFindings([a, b], "Ibuprofen")).toEqual([a, b]);
  });
  it("a class finding naming three medicines is replaced by the two rule findings that cover both of its pairs", () => {
    // Two ACE inhibitors already on the list, losartan being added: S53 names all three, the rules name each pair.
    const cls = s53("contraindicated", ["Lisinopril", "Ramipril", "Losartan"]);
    const r1 = rule("contraindicated", ["Losartan", "Lisinopril"]);
    const r2 = rule("contraindicated", ["Losartan", "Ramipril"]);
    expect(mergeAddFindings([cls, r1, r2], "Losartan")).toEqual([r1, r2]);
  });
  it("a class finding naming three medicines stays when only one of its pairs has a rule, and a twin at least as severe stays too", () => {
    const cls = s53("caution", ["Lisinopril", "Ramipril", "Losartan"]);
    const r1 = rule("caution", ["Losartan", "Lisinopril"]);
    expect(mergeAddFindings([cls, r1], "Losartan")).toEqual([cls, r1]);
    const r1Low = rule("info", ["Losartan", "Lisinopril"]);
    expect(mergeAddFindings([cls, r1Low], "Losartan")).toEqual([cls]);
  });
  it("partial cover with mixed twins: the class finding stays, an equally severe twin stays, a less severe twin goes", () => {
    const cls = s53("caution", ["Lisinopril", "Ramipril", "Enalapril", "Losartan"]);
    const equal = rule("caution", ["Losartan", "Lisinopril"]);
    const lower = rule("info", ["Losartan", "Ramipril"]);
    expect(mergeAddFindings([lower, cls, equal], "Losartan")).toEqual([cls, equal]);
  });
  it("a more severe class finding naming three medicines drops all of its less severe twins", () => {
    const cls = s53("contraindicated", ["Lisinopril", "Ramipril", "Losartan"]);
    const r1 = rule("caution", ["Losartan", "Lisinopril"]);
    const r2 = rule("caution", ["Losartan", "Ramipril"]);
    expect(mergeAddFindings([r1, cls, r2], "Losartan")).toEqual([cls]);
  });
  it("two rule findings for the same other medicine keep the more severe one", () => {
    const low = rule("caution", ["Losartan", "Lisinopril"]);
    const high = rule("contraindicated", ["Losartan", "Lisinopril"]);
    expect(mergeAddFindings([low, high], "Losartan")).toEqual([high]);
    expect(mergeAddFindings([high, low], "Losartan")).toEqual([high]);
  });
  it("collapses a class duplicate and a same-ingredient finding for one pair into the more severe one", () => {
    expect(mergeAddFindings([same, dup], "Norvasc")).toEqual([dup]);
    expect(mergeAddFindings([dup, same], "Norvasc")).toEqual([dup]);
  });
  it("keeps an interaction and a duplicate warning for the same pair (different families)", () => {
    const inter = s53("caution", ["Amlodipine", "Norvasc"]);
    expect(mergeAddFindings([same, inter], "Norvasc")).toEqual([same, inter]);
  });
  it("orders the result worst first", () => {
    const low = s53("caution", ["Lisinopril", "Ibuprofen"]);
    const high = rule("contraindicated", ["Ibuprofen", "Warfarin"]);
    const note: AddCheckFinding = { kind: "rule", severity: "info", drugNames: ["Ibuprofen", "Omeprazole"], adviceKey: "medicines.rules.advice.note" };
    expect(mergeAddFindings([note, low, high], "Ibuprofen").map((f) => f.severity)).toEqual(["contraindicated", "caution", "info"]);
  });
  it("does not change its input", () => {
    const input = [s53("caution", ["A", "B"]), rule("caution", ["B", "A"])];
    const copy = input.map((f) => ({ ...f, drugNames: [...f.drugNames] }));
    mergeAddFindings(input, "B");
    expect(input).toEqual(copy);
  });
});
