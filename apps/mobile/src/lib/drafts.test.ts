import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from "./drafts";
import { clearLocalMirror } from "./offline-store";

let mockUser: string | null = "user-1";
jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) } },
}));

beforeEach(() => {
  mockUser = "user-1";
});

describe("drafts", () => {
  it("saves on every change, keeping only the latest value, and loads it back", async () => {
    await saveDraft("bp:p1", { sys: "1", dia: "" });
    await saveDraft("bp:p1", { sys: "150", dia: "9" });
    expect(await loadDraft("bp:p1")).toEqual({ sys: "150", dia: "9" });
  });
  it("returns null when there is none, and after it is cleared", async () => {
    expect(await loadDraft("nothing")).toBeNull();
    await saveDraft("k", "v");
    await clearDraft("k");
    expect(await loadDraft("k")).toBeNull();
  });
  it("keeps drafts for different forms apart, and clearAll empties the signed-in account's", async () => {
    await saveDraft("a", 1);
    await saveDraft("b", 2);
    expect(await loadDraft("a")).toBe(1);
    await clearAllDrafts();
    expect(await loadDraft("b")).toBeNull();
  });

  // S06x, decision D2
  it("keeps a draft, encrypted and tied to its account, through sign-out and the mirror wipe, and gives it back to that account", async () => {
    await saveDraft("bp:p1", { sys: "142" });
    mockUser = null; // forced sign-out
    await clearLocalMirror(); // what App.tsx does on SIGNED_OUT
    expect(await loadDraft("bp:p1")).toBeNull(); // nobody is signed in: nothing is readable
    mockUser = "user-1";
    expect(await loadDraft("bp:p1")).toEqual({ sys: "142" });
  });

  it("never shows one account's draft to another account on the same phone", async () => {
    await saveDraft("bp:p1", { sys: "142" });
    mockUser = "user-2";
    expect(await loadDraft("bp:p1")).toBeNull();
    await saveDraft("bp:p1", { sys: "99" });
    await clearAllDrafts(); // user-2 clearing theirs
    mockUser = "user-1";
    expect(await loadDraft("bp:p1")).toEqual({ sys: "142" });
  });

  it("does not store a draft with nobody signed in", async () => {
    mockUser = null;
    await saveDraft("k", "v");
    mockUser = "user-1";
    expect(await loadDraft("k")).toBeNull();
  });
});
