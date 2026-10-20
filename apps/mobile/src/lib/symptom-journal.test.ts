import { loadJournal, parseJournal } from "./symptom-journal";

let mockRpc: { data?: unknown; error?: { code?: string; message: string } } = {};
let mockOutbox: unknown[] = [];
let mockMirror: unknown[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: async () => (mockRpc.error ? { data: null, error: mockRpc.error } : { data: mockRpc.data, error: null }),
  },
}));
jest.mock("./outbox", () => ({ listOutbox: async () => mockOutbox }));
jest.mock("./offline-store", () => ({ readLocalRecords: async () => mockMirror }));

const rpcRow = (id: string, at: string, extra: Record<string, unknown> = {}) => ({
  symptom_id: id,
  reported_at: at,
  symptom_type: "fatigue",
  free_text: null,
  severity: 4,
  assessment_id: null,
  triage_grade: null,
  ...extra,
});

beforeEach(() => {
  mockRpc = {};
  mockOutbox = [];
  mockMirror = [];
});

describe("symptom journal on the phone (S43m)", () => {
  it("keeps only well-formed rows and only the three known grades", () => {
    const rows = parseJournal([rpcRow("a", "2026-10-01T10:00:00Z", { triage_grade: "red", assessment_id: "x" }), { bad: true }, rpcRow("b", "2026-10-02T10:00:00Z", { triage_grade: "purple" })]);
    expect(rows.map((r) => [r.id, r.triageGrade, r.fromCheck])).toEqual([
      ["a", "red", true],
      ["b", null, false],
    ]);
    expect(parseJournal(null)).toEqual([]);
  });

  it("reads the journal newest first", async () => {
    mockRpc = { data: [rpcRow("a", "2026-10-01T10:00:00Z"), rpcRow("b", "2026-10-03T10:00:00Z")] };
    const r = await loadJournal("user-1");
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(["b", "a"]);
    expect(r.ok && r.stale).toBe(false);
  });

  it("shows a symptom noted with no signal as waiting, never as sent", async () => {
    mockRpc = { data: [rpcRow("a", "2026-10-01T10:00:00Z")] };
    mockOutbox = [{ clientId: "c1", state: "pending", subjectId: "user-1", clientRecordedAt: "2026-10-04T10:00:00Z", payload: { symptom_type: "dizziness", severity: 6, description: "on standing" } }];
    const r = await loadJournal("user-1");
    expect(r.ok && r.rows[0]).toMatchObject({ waiting: true, symptomType: "dizziness", triageGrade: null });
  });

  it("does not show another person's waiting entries", async () => {
    mockRpc = { data: [] };
    mockOutbox = [{ clientId: "c1", state: "pending", subjectId: "someone-else", clientRecordedAt: "2026-10-04T10:00:00Z", payload: { symptom_type: "pain", severity: 1, description: null } }];
    const r = await loadJournal("user-1");
    expect(r.ok && r.rows).toHaveLength(0);
  });

  it("keeps an entry the server refused in view, marked not sent, never as sent and never dropped", async () => {
    mockRpc = { data: [] };
    mockOutbox = [{ clientId: "c2", state: "rejected", subjectId: "user-1", clientRecordedAt: "2026-10-04T10:00:00Z", payload: { symptom_type: "pain", severity: 1, description: null } }];
    const r = await loadJournal("user-1");
    expect(r.ok && r.rows).toHaveLength(1);
    expect(r.ok && r.rows[0]).toMatchObject({ rejected: true, waiting: false });
  });

  it("offline with nothing saved falls back to the symptoms mirrored on the phone, without grades", async () => {
    mockRpc = { error: { message: "Network request failed" } };
    mockMirror = [{ id: "m1", reported_at: "2026-10-02T10:00:00Z", symptom_type: "nausea", description: null, severity: 3, assessment_id: "z" }];
    const r = await loadJournal("user-1");
    expect(r).toMatchObject({ ok: true, stale: true, offline: true });
    expect(r.ok && r.rows[0]).toMatchObject({ id: "m1", triageGrade: null, fromCheck: true });
  });

  it("a refused read shows nothing from the phone's mirror either", async () => {
    mockRpc = { error: { code: "42501", message: "permission denied" } };
    mockMirror = [{ id: "m1", reported_at: "2026-10-02T10:00:00Z", symptom_type: "nausea", description: null, severity: 3, assessment_id: null }];
    expect(await loadJournal("user-1")).toEqual({ ok: false, offline: false });
  });

  it("offline with nothing at all is a failure, not an empty journal", async () => {
    mockRpc = { error: { message: "Network request failed" } };
    expect(await loadJournal("user-1")).toEqual({ ok: false, offline: true });
  });
});
