import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from "./drafts";

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
  it("keeps drafts for different forms apart, and clearAll empties them", async () => {
    await saveDraft("a", 1);
    await saveDraft("b", 2);
    expect(await loadDraft("a")).toBe(1);
    await clearAllDrafts();
    expect(await loadDraft("b")).toBeNull();
  });
});
