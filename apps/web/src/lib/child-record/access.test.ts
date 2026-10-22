import { mayPrintChildRecord } from "./access";

describe("who may print a child's record", () => {
  it("the child's own account, and a manager of a minor, may", () => {
    expect(mayPrintChildRecord("c1", "c1", null)).toBe(true);
    expect(mayPrintChildRecord("p1", "c1", { permissionLevel: "manage", categories: [], childIsMinorDependant: true })).toBe(true);
  });
  it("a view grant needs BOTH categories; one is not enough and none is refused (never a PDF of RLS-filtered emptiness)", () => {
    const g = (categories: string[]) => ({ permissionLevel: "view" as const, categories, childIsMinorDependant: true });
    expect(mayPrintChildRecord("d1", "c1", g(["medical_history", "vaccinations"]))).toBe(true);
    expect(mayPrintChildRecord("d1", "c1", g(["vaccinations"]))).toBe(false);
    expect(mayPrintChildRecord("d1", "c1", g(["medical_history"]))).toBe(false);
    expect(mayPrintChildRecord("d1", "c1", g([]))).toBe(false);
  });
  it("an expired grant is no grant, for a manage grant over a minor and for a view grant with both categories; an unexpired or open-ended one still works", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const manage = { permissionLevel: "manage" as const, categories: [], childIsMinorDependant: true };
    const view = { permissionLevel: "view" as const, categories: ["medical_history", "vaccinations"], childIsMinorDependant: true };
    for (const g of [manage, view]) {
      expect(mayPrintChildRecord("p1", "c1", { ...g, expiresAt: "2026-10-22T11:59:59Z" }, now)).toBe(false);
      expect(mayPrintChildRecord("p1", "c1", { ...g, expiresAt: "2026-10-22T12:00:00Z" }, now)).toBe(false);
      expect(mayPrintChildRecord("p1", "c1", { ...g, expiresAt: "2026-10-23T00:00:00Z" }, now)).toBe(true);
      expect(mayPrintChildRecord("p1", "c1", { ...g, expiresAt: null }, now)).toBe(true);
    }
  });
  it("no grant is refused, and a manager of someone 18 or over needs the categories like anyone else", () => {
    expect(mayPrintChildRecord("x", "c1", null)).toBe(false);
    expect(mayPrintChildRecord("p1", "c1", { permissionLevel: "manage", categories: [], childIsMinorDependant: false })).toBe(false);
    expect(mayPrintChildRecord("p1", "c1", { permissionLevel: "manage", categories: ["medical_history", "vaccinations"], childIsMinorDependant: false })).toBe(true);
  });
});
