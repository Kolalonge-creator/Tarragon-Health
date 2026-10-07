import { JOURNAL_ALG, newJournalKey, openJournalEntry, sealJournalEntry, fromBase64, toBase64, type RandomBytes } from "@tarragon/shared/journal-crypto";

/**
 * The private journal on the phone (S57, 10.8). The key lives in the platform secure store; entries are stored already sealed. Nothing in
 * this file talks to the server: backup (only when the person turns it on) pushes the sealed fields elsewhere. Storage is injected so the
 * logic is testable.
 */
export interface StoredEntry { id: string; alg: typeof JOURNAL_ALG; iv: string; ciphertext: string; updated_at: string }
export interface KeyStore { get(): Promise<string | null>; set(v: string): Promise<void> }
export interface EntryStore { all(): Promise<StoredEntry[]>; put(e: StoredEntry): Promise<void>; remove(id: string): Promise<void> }
export interface PlainEntry { text: string; prompt: string | null; created_at: string }
export interface JournalRow { id: string; updated_at: string; plain: PlainEntry | null }

export function createJournal(deps: { keys: KeyStore; entries: EntryStore; random: RandomBytes; newId: () => string; now: () => Date }) {
  async function key(): Promise<Uint8Array> {
    const existing = await deps.keys.get();
    if (existing) {
      const k = fromBase64(existing);
      if (k.length === 32) return k;
    }
    const k = newJournalKey(deps.random);
    await deps.keys.set(toBase64(k));
    return k;
  }
  return {
    async list(): Promise<JournalRow[]> {
      const k = await key();
      const all = await deps.entries.all();
      return all
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((e) => {
          const text = openJournalEntry(k, e.id, e);
          return { id: e.id, updated_at: e.updated_at, plain: text ? (JSON.parse(text) as PlainEntry) : null };
        });
    },
    async add(text: string, prompt: string | null): Promise<StoredEntry | null> {
      const clean = text.trim();
      if (clean.length === 0) return null;
      const id = deps.newId();
      const now = deps.now().toISOString();
      const sealed = sealJournalEntry(await key(), id, JSON.stringify({ text: clean, prompt, created_at: now } satisfies PlainEntry), deps.random);
      const rec: StoredEntry = { id, ...sealed, updated_at: now };
      await deps.entries.put(rec);
      return rec;
    },
    async remove(id: string): Promise<void> {
      await deps.entries.remove(id);
    },
    sealedAll: () => deps.entries.all(),
  };
}
