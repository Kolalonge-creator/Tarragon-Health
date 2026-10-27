/**
 * S07y: the phone offers the pharmacy box and the paper diary only while the matching server guard is open, and fails CLOSED: a guard it cannot read, and has
 * never learned, is a closed guard. A remembered "open" lets an offline phone keep behaving the way it last knew; the server still decides every save.
 */
import { loadProvenanceGuards, PROVENANCE_GUARD_KEYS } from "./provenance-guards";

let mockRpcAnswer: (key: string) => { data: unknown; error: unknown } | "throw";
jest.mock("./supabase", () => ({
  supabase: {
    rpc: async (_fn: string, args: { p_key: string }) => {
      const a = mockRpcAnswer(args.p_key);
      if (a === "throw") throw new Error("offline");
      return a;
    },
  },
}));

describe("loadProvenanceGuards", () => {
  it("asks the server for exactly the three guards", async () => {
    const asked: string[] = [];
    mockRpcAnswer = (k) => {
      asked.push(k);
      return { data: false, error: null };
    };
    await loadProvenanceGuards("p1");
    expect(asked.sort()).toEqual([...PROVENANCE_GUARD_KEYS].sort());
  });

  it("is closed everywhere when the server says so", async () => {
    mockRpcAnswer = () => ({ data: false, error: null });
    expect(await loadProvenanceGuards("p1")).toEqual({ pharmacyOpen: false, diaryEntryOpen: false, diaryReaderOpen: false });
  });

  it("opens each switch on its own", async () => {
    mockRpcAnswer = (k) => ({ data: k === "paper_diary_entry", error: null });
    expect(await loadProvenanceGuards("p1")).toEqual({ pharmacyOpen: false, diaryEntryOpen: true, diaryReaderOpen: false });
  });

  it("fails closed when it has never been able to read a guard", async () => {
    mockRpcAnswer = () => "throw";
    expect(await loadProvenanceGuards("p1")).toEqual({ pharmacyOpen: false, diaryEntryOpen: false, diaryReaderOpen: false });
    mockRpcAnswer = () => ({ data: null, error: { message: "boom" } });
    expect(await loadProvenanceGuards("p1")).toEqual({ pharmacyOpen: false, diaryEntryOpen: false, diaryReaderOpen: false });
  });

  it("an offline phone keeps the last answer it learned, per account", async () => {
    mockRpcAnswer = () => ({ data: true, error: null });
    await loadProvenanceGuards("p1");
    mockRpcAnswer = () => "throw";
    expect(await loadProvenanceGuards("p1")).toEqual({ pharmacyOpen: true, diaryEntryOpen: true, diaryReaderOpen: true });
    // another account has learned nothing
    expect(await loadProvenanceGuards("p2")).toEqual({ pharmacyOpen: false, diaryEntryOpen: false, diaryReaderOpen: false });
  });

  it("a server 'closed' replaces a remembered 'open'", async () => {
    mockRpcAnswer = () => ({ data: true, error: null });
    await loadProvenanceGuards("p1");
    mockRpcAnswer = () => ({ data: false, error: null });
    expect((await loadProvenanceGuards("p1")).pharmacyOpen).toBe(false);
    mockRpcAnswer = () => "throw";
    expect((await loadProvenanceGuards("p1")).pharmacyOpen).toBe(false);
  });
});
