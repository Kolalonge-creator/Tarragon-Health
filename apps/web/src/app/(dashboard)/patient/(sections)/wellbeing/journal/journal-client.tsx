"use client";

import { useCallback, useEffect, useState } from "react";
import { openJournalEntry, sealJournalEntry } from "@tarragon/shared/journal-crypto";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { browserRandom, deleteSealed, getOrCreateKey, listSealed, putSealed, type StoredEntry } from "@/lib/wellbeing-library/journal-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Plain { text: string; prompt: string | null; created_at: string }
interface Row { id: string; plain: Plain | null; updated_at: string }

/**
 * The private journal. Written and sealed on this device; the server sees nothing unless the person turns backup on, and then it
 * stores ciphertext it cannot read. No staff, sponsor or Care Circle path exists. Prompts come from reviewed library items.
 */
export function JournalClient({ prompts, patientId }: { prompts: { code: string; title: string; text: string }[]; patientId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [key, setKey] = useState<Uint8Array | null>(null);
  const [locked, setLocked] = useState(false);
  const [sync, setSync] = useState(false);
  const [syncErr, setSyncErr] = useState(false);
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState(false);

  const push = useCallback(async (e: StoredEntry) => {
    const { error } = await createClient().rpc("upsert_journal_entry", { p_client_entry_id: e.id, p_alg: e.alg, p_iv: e.iv, p_ciphertext: e.ciphertext, p_client_updated_at: e.updated_at });
    if (error) setSyncErr(true);
  }, []);

  const load = useCallback(async (k: Uint8Array) => {
    const sealed = await listSealed();
    setRows(sealed.map((s) => {
      const text = openJournalEntry(k, s.id, s);
      return { id: s.id, updated_at: s.updated_at, plain: text ? (JSON.parse(text) as Plain) : null };
    }));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const k = await getOrCreateKey();
        setKey(k);
        await load(k);
      } catch {
        setLocked(true);
      }
      const { data } = await createClient().from("journal_sync_settings").select("enabled").eq("patient_id", patientId).maybeSingle();
      const on = data?.enabled === true;
      setSync(on);
      // Backup catches up: anything written while offline is sent now (the server keeps the newer copy of each entry).
      if (on) for (const e of await listSealed()) await push(e);
    })();
  }, [load, patientId, push]);

  async function save() {
    if (!key || draft.trim().length === 0) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const plain: Plain = { text: draft.trim(), prompt: prompt || null, created_at: now };
    const sealed = sealJournalEntry(key, id, JSON.stringify(plain), browserRandom);
    const rec: StoredEntry = { id, ...sealed, updated_at: now };
    await putSealed(rec);
    if (sync) await push(rec);
    setDraft("");
    setSaved(true);
    await load(key);
  }

  async function remove(id: string) {
    await deleteSealed(id);
    if (sync) await createClient().rpc("delete_journal_entry", { p_client_entry_id: id });
    if (key) await load(key);
  }

  async function toggleSync(next: boolean) {
    setSyncErr(false);
    const { error } = await createClient().rpc("set_journal_sync", { p_enabled: next });
    if (error) return setSyncErr(true);
    setSync(next);
    if (next) for (const e of await listSealed()) await push(e);
  }

  if (locked) return <p className="text-sm">{t("journal.locked")}</p>;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid gap-1">
            <label htmlFor="journal-prompt" className="text-sm">{t("journal.prompt_label")}</label>
            <select id="journal-prompt" value={prompt} onChange={(e) => { setPrompt(e.target.value); setSaved(false); }} className="rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm">
              <option value="">{t("journal.no_prompt")}</option>
              {prompts.map((p) => (<option key={p.code} value={p.text}>{p.title}</option>))}
            </select>
          </div>
          {prompt && <p className="text-sm italic">{prompt}</p>}
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
            rows={6}
            maxLength={8000}
            placeholder={t("journal.placeholder")}
            aria-label={t("journal.placeholder")}
            className="w-full rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent p-2 text-sm"
          />
          <Button type="button" onClick={save} disabled={!key || draft.trim().length === 0}>{t("journal.save")}</Button>
          {saved && <p role="status" className="text-sm text-brand-green dark:text-brand-green-bright">{t("journal.saved")}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {rows.length === 0 ? (
            <p className="text-sm">{t("journal.empty")}</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{new Date(r.updated_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</p>
                  {r.plain ? (<>
                    {r.plain.prompt && <p className="text-xs italic">{r.plain.prompt}</p>}
                    <p className="whitespace-pre-wrap text-sm">{r.plain.text}</p>
                  </>) : (<p className="text-sm">{t("journal.locked")}</p>)}
                  <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => remove(r.id)}>{t("journal.delete")}</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("journal.sync.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">{t("journal.sync.body")}</p>
          <p className="text-sm font-medium">{sync ? t("journal.sync.state_on") : t("journal.sync.state_off")}</p>
          <Button type="button" variant="outline" onClick={() => toggleSync(!sync)}>{sync ? t("journal.sync.off") : t("journal.sync.on")}</Button>
          {syncErr && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("journal.sync.error")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
