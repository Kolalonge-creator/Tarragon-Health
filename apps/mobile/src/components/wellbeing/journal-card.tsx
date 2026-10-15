import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { t } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { createJournal, type JournalRow, type StoredEntry } from "@/lib/journal-store";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const KEY_NAME = "tarragon.journal.key.v1";
const ENTRIES = "tarragon.journal.entries.v1";

/**
 * The private journal (S57, 10.8). Entries are sealed on this phone with a key held in the secure store; the server sees nothing unless
 * the person turns backup on, and then it stores ciphertext it cannot read. No staff, sponsor or Care Circle path exists.
 */
export function JournalCard({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const inputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const journal = useMemo(
    () =>
      createJournal({
        keys: { get: () => SecureStore.getItemAsync(KEY_NAME), set: (v) => SecureStore.setItemAsync(KEY_NAME, v) },
        entries: {
          all: async () => JSON.parse((await AsyncStorage.getItem(ENTRIES)) ?? "[]") as StoredEntry[],
          put: async (e) => {
            const all = JSON.parse((await AsyncStorage.getItem(ENTRIES)) ?? "[]") as StoredEntry[];
            await AsyncStorage.setItem(ENTRIES, JSON.stringify([...all.filter((x) => x.id !== e.id), e]));
          },
          remove: async (id) => {
            const all = JSON.parse((await AsyncStorage.getItem(ENTRIES)) ?? "[]") as StoredEntry[];
            await AsyncStorage.setItem(ENTRIES, JSON.stringify(all.filter((x) => x.id !== id)));
          },
        },
        random: (n) => Crypto.getRandomBytes(n),
        newId: () => Crypto.randomUUID(),
        now: () => new Date(),
      }),
    [],
  );
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sync, setSync] = useState(false);
  const [failed, setFailed] = useState<"locked" | "sync" | null>(null);
  const [saved, setSaved] = useState(false);

  const push = useCallback(async (e: StoredEntry) => {
    const { error } = await supabase.rpc("upsert_journal_entry", { p_client_entry_id: e.id, p_alg: e.alg, p_iv: e.iv, p_ciphertext: e.ciphertext, p_client_updated_at: e.updated_at });
    if (error) setFailed("sync");
  }, []);

  const reload = useCallback(async () => {
    try { setRows(await journal.list()); } catch { setFailed("locked"); }
  }, [journal]);
  useEffect(() => {
    if (!open) return;
    void reload();
    void supabase.from("journal_sync_settings").select("enabled").eq("patient_id", patientId).maybeSingle().then(async ({ data }) => {
      const on = data?.enabled === true;
      setSync(on);
      // Backup catches up: anything written while offline is sent now (the server keeps the newer copy of each entry).
      if (on) for (const e of await journal.sealedAll()) await push(e);
    });
  }, [open, reload, patientId, journal, push]);

  if (!open) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("journal.title")}</Text>
        <MutedText>{t("journal.intro")}</MutedText>
        <SecondaryButton title={t("library.open")} onPress={() => setOpen(true)} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("journal.title")}</Text>
      {failed === "locked" && <ErrorText>{t("journal.locked")}</ErrorText>}
      <TextInput
        value={draft}
        onChangeText={(v) => { setDraft(v); setSaved(false); }}
        multiline
        maxLength={8000}
        placeholder={t("journal.placeholder")}
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        accessibilityLabel={t("journal.placeholder")}
        style={[inputStyle, { minHeight: 110, textAlignVertical: "top" }]}
      />
      <PrimaryButton
        title={t("journal.save")}
        onPress={async () => {
          const rec = await journal.add(draft, null);
          if (!rec) return;
          if (sync) await push(rec);
          setDraft("");
          setSaved(true);
          await reload();
        }}
      />
      {saved && <Text accessibilityRole="alert" style={{ color: colors.ink }}>{t("journal.saved")}</Text>}
      {rows.length === 0 ? (
        <MutedText>{t("journal.empty")}</MutedText>
      ) : (
        rows.map((r) => (
          <View key={r.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, gap: 4 }}>
            <MutedText>{new Date(r.updated_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}</MutedText>
            <Text style={{ color: colors.ink }}>{r.plain ? r.plain.text : t("journal.locked")}</Text>
            <SecondaryButton
              title={t("journal.delete")}
              onPress={async () => {
                await journal.remove(r.id);
                if (sync) await supabase.rpc("delete_journal_entry", { p_client_entry_id: r.id });
                await reload();
              }}
            />
          </View>
        ))
      )}
      <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{t("journal.sync.title")}</Text>
      <MutedText>{t("journal.sync.body")}</MutedText>
      <MutedText>{sync ? t("journal.sync.state_on") : t("journal.sync.state_off")}</MutedText>
      <SecondaryButton
        title={sync ? t("journal.sync.off") : t("journal.sync.on")}
        onPress={async () => {
          setFailed(null);
          const next = !sync;
          const { error } = await supabase.rpc("set_journal_sync", { p_enabled: next });
          if (error) return setFailed("sync");
          setSync(next);
          if (next) for (const e of await journal.sealedAll()) await push(e);
        }}
      />
      {failed === "sync" && <ErrorText>{t("journal.sync.error")}</ErrorText>}
      <SecondaryButton title={t("library.back")} onPress={() => setOpen(false)} />
    </Card>
  );
}
