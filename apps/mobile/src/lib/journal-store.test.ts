import { describe, expect, it } from "@jest/globals";
import { createJournal, type EntryStore, type KeyStore, type StoredEntry } from "./journal-store";

function memory() {
  let key: string | null = null;
  const rows = new Map<string, StoredEntry>();
  const keys: KeyStore = { get: async () => key, set: async (v) => { key = v; } };
  const entries: EntryStore = { all: async () => [...rows.values()], put: async (e) => { rows.set(e.id, e); }, remove: async (id) => { rows.delete(id); } };
  return { keys, entries, rows, dropKey: () => { key = null; } };
}
let n = 0;
const random = (len: number) => Uint8Array.from({ length: len }, (_, i) => (i * 13 + ++n) % 256);
const mk = (m: ReturnType<typeof memory>, id = "e1") => createJournal({ keys: m.keys, entries: m.entries, random, newId: () => id + n++, now: () => new Date("2026-10-07T10:00:00Z") });

describe("mobile journal store", () => {
  it("stores only sealed data and reads it back", async () => {
    const m = memory();
    const j = mk(m);
    await j.add("A heavy day at work", "What went okay?");
    const raw = JSON.stringify([...m.rows.values()]);
    expect(raw).not.toContain("heavy");
    expect(raw).not.toContain("What went okay");
    const list = await j.list();
    expect(list[0]?.plain?.text).toBe("A heavy day at work");
  });
  it("refuses an empty entry", async () => {
    expect(await mk(memory()).add("   ", null)).toBeNull();
  });
  it("a lost key leaves entries unreadable, never garbled", async () => {
    const m = memory();
    const j = mk(m);
    await j.add("private", null);
    m.dropKey();
    const list = await mk(m).list();
    expect(list[0]?.plain).toBeNull();
  });
  it("removes an entry", async () => {
    const m = memory();
    const j = mk(m);
    const e = await j.add("x", null);
    await j.remove(e?.id ?? "");
    expect((await j.list()).length).toBe(0);
  });
});
