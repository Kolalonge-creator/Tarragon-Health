import { describe, expect, it } from "@jest/globals";
import { applyClientTable, nextSort, type ClientRow } from "./data-table-model";

const rows: (ClientRow & { name: string })[] = [
  { key: "a", name: "Ade", sort: ["Ade", 300, "2026-11-01"], searchText: "Ade Lagos" },
  { key: "b", name: "bola", sort: ["bola", 20, null], searchText: "Bola Abuja" },
  { key: "c", name: "Chi", sort: ["Chi", null, "2026-10-01"], searchText: "Chi Lagos" },
  { key: "d", name: "Dayo", sort: ["Dayo", 100, "2026-11-05"] },
];
const keys = (r: { rows: ClientRow[] }) => r.rows.map((x) => x.key);

describe("applyClientTable", () => {
  it("keeps the page's own order with no sort and no search", () => {
    expect(keys(applyClientTable(rows, { query: "", sort: null, page: 0, pageSize: 10 }))).toEqual(["a", "b", "c", "d"]);
  });

  it("searches case-blind, and a row with no search text never matches a search", () => {
    const r = applyClientTable(rows, { query: "  LAGOS ", sort: null, page: 0, pageSize: 10 });
    expect(keys(r)).toEqual(["a", "c"]);
    expect(r.matching).toBe(2);
    expect(applyClientTable(rows, { query: "dayo", sort: null, page: 0, pageSize: 10 }).matching).toBe(0);
  });

  it("sorts numbers as numbers, not text (20 before 100 before 300)", () => {
    expect(keys(applyClientTable(rows, { query: "", sort: { column: 1, dir: "asc" }, page: 0, pageSize: 10 }))).toEqual(["b", "d", "a", "c"]);
  });

  it("puts a missing value last in both directions", () => {
    expect(keys(applyClientTable(rows, { query: "", sort: { column: 1, dir: "desc" }, page: 0, pageSize: 10 })).at(-1)).toBe("c");
    expect(keys(applyClientTable(rows, { query: "", sort: { column: 2, dir: "asc" }, page: 0, pageSize: 10 })).at(-1)).toBe("b");
  });

  it("sorts text without regard to capitals", () => {
    expect(keys(applyClientTable(rows, { query: "", sort: { column: 0, dir: "asc" }, page: 0, pageSize: 10 }))).toEqual(["a", "b", "c", "d"]);
  });

  it("pages, and clamps a page that a search has made too high", () => {
    const p2 = applyClientTable(rows, { query: "", sort: null, page: 1, pageSize: 3 });
    expect([keys(p2), p2.pageCount, p2.page]).toEqual([["d"], 2, 1]);
    const clamped = applyClientTable(rows, { query: "lagos", sort: null, page: 5, pageSize: 3 });
    expect([keys(clamped), clamped.page, clamped.pageCount]).toEqual([["a", "c"], 0, 1]);
  });

  it("returns every row in sorted order, searched or not, so hidden rows can stay mounted", () => {
    const r = applyClientTable(rows, { query: "lagos", sort: { column: 1, dir: "asc" }, page: 0, pageSize: 1 });
    expect(r.ordered.map((x) => x.key)).toEqual(["b", "d", "a", "c"]);
    expect(keys(r)).toEqual(["a"]);
  });

  it("does not reorder the caller's array", () => {
    const before = rows.map((r) => r.key);
    applyClientTable(rows, { query: "", sort: { column: 1, dir: "asc" }, page: 0, pageSize: 10 });
    expect(rows.map((r) => r.key)).toEqual(before);
  });
});

describe("nextSort", () => {
  it("starts a new column on its default direction and flips the same column", () => {
    expect(nextSort(null, 2, "desc")).toEqual({ column: 2, dir: "desc" });
    expect(nextSort({ column: 2, dir: "desc" }, 2)).toEqual({ column: 2, dir: "asc" });
    expect(nextSort({ column: 2, dir: "asc" }, 0)).toEqual({ column: 0, dir: "asc" });
  });
});
