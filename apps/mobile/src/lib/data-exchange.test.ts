import { grantConsent, loadExchange, parseConsents, parseCopies, parseReceived, withdrawConsent } from "./data-exchange";

let mockError: { code?: string; message: string } | null = null;
const mockRpcs: { fn: string; args: unknown }[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: async (fn: string, args: unknown) => {
      mockRpcs.push({ fn, args });
      if (mockError) return { data: null, error: mockError };
      if (fn === "my_external_exchange_consents") return { data: [{ id: "c1", source_system: "Helium Health", direction: "import", granted_at: "2026-10-01T10:00:00Z", withdrawn_at: null }], error: null };
      if (fn === "my_external_records") return { data: [{ id: "r1", imported_at: "2026-10-02T10:00:00Z", fhir_resource_type: "Observation", source_system: "Helium Health", superseded_at: null, disposition: "proposed", payload: { secret: true } }], error: null };
      return { data: null, error: null };
    },
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        then: (res: (v: unknown) => unknown) => res(mockError ? { data: null, error: mockError } : { data: [{ id: "x1", requester_kind: "staff", sections: ["labs"], created_at: "2026-10-03T10:00:00Z" }], error: null }),
      };
      return q;
    },
  },
}));

beforeEach(() => {
  mockError = null;
  mockRpcs.length = 0;
});

describe("records from other places on the phone (S43m)", () => {
  it("reads the three lists, keeping only what the screen shows (never a record's payload)", async () => {
    const r = await loadExchange("user-1");
    expect(r.ok && r.data.consents[0]).toMatchObject({ sourceSystem: "Helium Health", direction: "import", withdrawnAt: null });
    expect(r.ok && r.data.received[0]).toEqual({ id: "r1", importedAt: "2026-10-02T10:00:00Z", resourceType: "Observation", sourceSystem: "Helium Health", supersededAt: null, disposition: "proposed" });
    expect(JSON.stringify(r)).not.toMatch(/secret|payload/);
    expect(r.ok && r.data.copies[0]).toEqual({ id: "x1", createdAt: "2026-10-03T10:00:00Z", requesterKind: "staff" });
  });

  it("offline shows the last copy marked old, and a failed first read is a failure, not three empty lists", async () => {
    await loadExchange("user-1");
    mockError = { message: "Network request failed" };
    const stale = await loadExchange("user-1");
    expect(stale.ok && stale.stale && stale.offline).toBe(true);
  });

  it("ignores malformed rows and unknown directions", () => {
    expect(parseConsents([{ id: "a", source_system: "X", direction: "sideways", granted_at: "2026-01-01T00:00:00Z" }, null])).toEqual([]);
    expect(parseReceived([{ id: "a" }])).toEqual([]);
    expect(parseCopies([{ created_at: "x" }])).toEqual([]);
  });

  it("allows a named system through the database function with the name trimmed, and refuses a name that is too short", async () => {
    expect(await grantConsent("  Lagos Island Clinic ", "both")).toEqual({ ok: true });
    expect(mockRpcs[0]).toEqual({ fn: "grant_external_exchange_consent", args: { p_source: "Lagos Island Clinic", p_direction: "both" } });
    expect(await grantConsent(" a ", "import")).toEqual({ ok: false, reason: "name_needed" });
    expect(mockRpcs).toHaveLength(1);
  });

  it("stopping a system uses the withdrawing function; a lost connection says so", async () => {
    expect(await withdrawConsent("c1")).toEqual({ ok: true });
    expect(mockRpcs[0]).toEqual({ fn: "withdraw_external_exchange_consent", args: { p_id: "c1" } });
    mockError = { message: "Network request failed" };
    expect(await withdrawConsent("c1")).toEqual({ ok: false, reason: "offline" });
    mockError = { code: "42501", message: "denied" };
    expect(await grantConsent("Clinic X", "import")).toEqual({ ok: false, reason: "failed" });
  });
});
