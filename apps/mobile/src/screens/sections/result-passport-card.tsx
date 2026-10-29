import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Share, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@tarragon/i18n";
import { isPassportOpen, PASSPORT_DEFAULT_ON, PASSPORT_PERIOD_DAYS, PASSPORT_SECTIONS, savePassportCopy, type PassportSection } from "@/lib/result-passport";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

/**
 * Result passport on the phone (item 10): choose what goes in, build the PDF and keep a copy on this phone for a clinic with no signal.
 * Hidden entirely while the `result_passport_enabled` guard is closed. Patient-initiated: nothing is built until the button is tapped.
 * Large text, plain words, no colour-only signals. The share-link controls below this card are unchanged.
 */
export function ResultPassportCard() {
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PassportSection[]>([...PASSPORT_DEFAULT_ON]);
  const [days, setDays] = useState<number>(PASSPORT_PERIOD_DAYS[0]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ uri: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void isPassportOpen().then((o) => live && setOpen(o));
    return () => {
      live = false;
    };
  }, []);

  if (!open) return null;

  async function save() {
    if (busy || picked.length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    const out = await savePassportCopy(picked, days);
    setBusy(false);
    if (out.ok) {
      setSaved({ uri: out.uri, name: out.name });
      return;
    }
    setError(out.kind === "offline" ? t("cuffcam.offline") : out.kind === "not_open" ? t("resultpassport.not_open") : t("resultpassport.save_failed"));
  }

  return (
    <Card style={{ gap: 12 }}>
      <AppText variant="title">{t("resultpassport.title")}</AppText>
      <MutedText>{t("resultpassport.description")}</MutedText>
      {PASSPORT_SECTIONS.map((s) => {
        const on = picked.includes(s.id);
        return (
          <Pressable
            key={s.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => setPicked((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, minHeight: 44 }}
          >
            <Ionicons name={on ? "checkbox" : "square-outline"} size={26} color={on ? colors.brand : colors.muted} />
            <AppText variant="bodyLarge" style={{ flexShrink: 1 }}>{s.label}</AppText>
          </Pressable>
        );
      })}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {PASSPORT_PERIOD_DAYS.map((d) => (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityState={{ selected: days === d }}
            onPress={() => setDays(d)}
            style={{ borderWidth: 1, borderColor: days === d ? colors.brand : colors.border, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: days === d ? "700" : "500" }}>{`Last ${d} days`}</Text>
          </Pressable>
        ))}
      </View>
      <MutedText>{t("resultpassport.note_left_out")}</MutedText>
      {busy ? <ActivityIndicator color={colors.brand} /> : <PrimaryButton title={t("resultpassport.save_phone")} onPress={() => void save()} disabled={picked.length === 0} />}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {saved ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "600" }}>{t("resultpassport.saved_phone")}</Text>
          <MutedText>{saved.name}</MutedText>
          <Pressable accessibilityRole="button" onPress={() => void Share.share({ url: saved.uri, title: saved.name })} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: colors.brand, fontSize: 16, fontWeight: "700" }}>{t("resultpassport.open_send")}</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}
