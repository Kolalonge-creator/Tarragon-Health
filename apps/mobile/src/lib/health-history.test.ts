import { en } from "@tarragon/i18n";
import { FAMILY_RELATIONSHIPS } from "@tarragon/shared";
import { addFamilyHistory, addProcedure, loadHistory, procedureWhen, relativeLabel, removeHistoryItem } from "./health-history";

let mockUser: string | null = "user-1";
let mockFail: { code?: string; message: string } | null = null;
const mockInserts: { table: string; row: Record<string, unknown> }[] = [];
const mockRpcs: { fn: string; args: unknown }[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) },
    from: (table: string) => ({
      select: () => {
        const q: Record<string, unknown> = {
          eq: () => q,
          order: () => q,
          limit: () => q,
          then: (res: (v: unknown) => unknown) =>
            res(
              mockFail
                ? { data: null, error: mockFail }
                : { data: table === "procedures" ? [{ id: "p1", name: "Appendectomy", approximate_year: 2010, performed_on: null, facility: null, verified_by_clinician: false }] : [], error: null }
            ),
        };
        return q;
      },
      insert: async (row: Record<string, unknown>) => {
        mockInserts.push({ table, row });
        return { error: mockFail };
      },
    }),
    rpc: async (fn: string, args: unknown) => {
      mockRpcs.push({ fn, args });
      return { error: mockFail };
    },
  },
}));

beforeEach(() => {
  mockUser = "user-1";
  mockFail = null;
  mockInserts.length = 0;
  mockRpcs.length = 0;
});

const ctx = { userId: "user-1", organisationId: "org-1" };

describe("health history on the phone (S43m)", () => {
  it("reads, and keeps the copy for offline", async () => {
    const live = await loadHistory("user-1", true);
    expect(live.ok && !live.stale && live.data.procedures).toHaveLength(1);
    mockFail = { message: "Network request failed" };
    const offline = await loadHistory("user-1", true);
    expect(offline.ok && offline.stale && offline.offline && offline.data.procedures[0].name).toBe("Appendectomy");
  });

  it("with nothing saved, a failed read is a failure and not an empty history", async () => {
    mockUser = "user-9";
    mockFail = { message: "Network request failed" };
    expect(await loadHistory("user-9", true)).toEqual({ ok: false, offline: true });
  });

  it("a supporter reads live, without family history (owner only) and without keeping a copy", async () => {
    const live = await loadHistory("someone-else", false);
    expect(live.ok && !live.stale && live.data.family).toEqual([]);
    expect(live.ok && live.data.procedures).toHaveLength(1);
    mockFail = { message: "Network request failed" };
    expect(await loadHistory("someone-else", false)).toEqual({ ok: false, offline: true });
  });

  it("withdrawn access is not served from a saved copy", async () => {
    await loadHistory("user-1", true);
    mockFail = { code: "42501", message: "permission denied" };
    expect(await loadHistory("user-1", true)).toEqual({ ok: false, offline: false });
  });

  it("adds a procedure with the person's own id and organisation, and only what was typed", async () => {
    expect(await addProcedure({ name: " Caesarean ", year: "2019", facility: "LUTH" }, ctx)).toEqual({ ok: true });
    expect(mockInserts).toEqual([{ table: "procedures", row: { organisation_id: "org-1", patient_id: "user-1", name: "Caesarean", approximate_year: 2019, facility: "LUTH" } }]);
  });

  it("never sends a source, a verification or a recorder: the database fixes those", async () => {
    await addProcedure({ name: "x" }, ctx);
    await addFamilyHistory({ condition: "Diabetes", relationship: "mother", onsetAge: "50" }, ctx);
    expect(mockInserts).toHaveLength(2);
    for (const i of mockInserts) {
      expect(i.row).not.toHaveProperty("source");
      expect(i.row).not.toHaveProperty("verified_by_clinician");
      expect(i.row).not.toHaveProperty("recorded_by");
    }
  });

  it("refuses bad input before any network call", async () => {
    expect(await addProcedure({ name: "" }, ctx)).toEqual({ ok: false, reason: "name_required" });
    expect(await addFamilyHistory({ condition: "x", relationship: "cousin" }, ctx)).toEqual({ ok: false, reason: "relationship_invalid" });
    expect(mockInserts).toHaveLength(0);
  });

  it("says needs a connection when offline and failed otherwise", async () => {
    mockFail = { message: "Network request failed" };
    expect(await addProcedure({ name: "x" }, ctx)).toEqual({ ok: false, reason: "offline" });
    expect(await removeHistoryItem("procedure", "p1")).toEqual({ ok: false, reason: "offline" });
    mockFail = { code: "42501", message: "denied" };
    expect(await addProcedure({ name: "x" }, ctx)).toEqual({ ok: false, reason: "failed" });
  });

  it("removal goes through the tombstone function", async () => {
    await removeHistoryItem("family_history", "f1");
    expect(mockRpcs).toEqual([{ fn: "remove_history_item", args: { p_kind: "family_history", p_id: "f1" } }]);
  });

  it("shows a year from a date, else the rough year, else nothing", () => {
    expect(procedureWhen({ performed_on: "2018-03-04", approximate_year: null })).toBe("2018");
    expect(procedureWhen({ performed_on: null, approximate_year: 2010 })).toBe("2010");
    expect(procedureWhen({ performed_on: null, approximate_year: null })).toBe("");
  });

  it("has a label for every relative, and shows an unknown older word plainly", () => {
    for (const r of FAMILY_RELATIONSHIPS) expect(Object.hasOwn(en, `mpass.relative.${r}`)).toBe(true);
    expect(relativeLabel("mother")).toBe("Mother");
    expect(relativeLabel("step_parent")).toBe("step parent");
  });

  it("has a message for every validation error", () => {
    for (const e of ["name_required", "name_too_long", "year_invalid", "year_future", "facility_too_long", "condition_required", "condition_too_long", "relationship_invalid", "onset_invalid"]) {
      expect(Object.hasOwn(en, `mpass.history.err.${e}`)).toBe(true);
    }
  });
});
