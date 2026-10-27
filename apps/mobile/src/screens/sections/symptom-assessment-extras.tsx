import { useState } from "react";
import { Share, Text, TextInput, View } from "react-native";
import { t } from "@tarragon/i18n";
import { explainerFactText, MAX_DESCRIBE_CHARS, safetyNetLines, type Explanation, type SafetyNet } from "@tarragon/symptom-triage-engine";
import { MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { useLegacyColors } from "@/ui/design";
import { radius } from "@/ui/theme";
import { describeOnDevice, tr, type MobileUx } from "@/lib/symptom-ux-model";

/**
 * S59c on the phone: the pieces a symptom result and the entry step are made of. English only, plain text, no images, and nothing here is
 * stored, logged or sent: the typed words stay in component state until used, the card lives in component state and is gone on "Clear this
 * screen". Everything that decides anything is in `@/lib/symptom-ux-model` and the engine package; these are the views.
 */
const label = (key: string): string => {
  const k = `symptom.opt.${key}`;
  const v = (t as (k: string) => string)(k);
  return !v || v === k ? key.replace(/_/g, " ") : v;
};

export function DescribeBox({
  complaints,
  ux,
  onChoose,
  onDanger,
}: {
  complaints: readonly { key: string; label: string }[];
  ux: MobileUx;
  onChoose: (key: string) => void;
  onDanger: (selfHarm: boolean) => void;
}) {
  const colors = useLegacyColors();
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<{ kind: "none" } | { kind: "match"; key: string } | { kind: "ambiguous"; keys: string[] } | { kind: "no_match" }>({ kind: "none" });
  const labelOf = (key: string) => complaints.find((c) => c.key === key)?.label ?? key;

  function find() {
    // the shared danger-phrase screen runs first, on this phone; a hit throws the words away at once
    const r = describeOnDevice(text, ux, complaints.map((c) => c.key));
    setText("");
    if (r.kind === "danger") {
      setOutcome({ kind: "none" });
      onDanger(r.selfHarm);
    } else if (r.kind === "match") setOutcome({ kind: "match", key: r.pathwayKey });
    else if (r.kind === "ambiguous") setOutcome({ kind: "ambiguous", keys: r.candidates });
    else setOutcome({ kind: "no_match" });
  }

  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{t("symptom.describe.title")}</Text>
      <MutedText>{t("symptom.describe.intro")}</MutedText>
      <TextInput
        accessibilityLabel={t("symptom.describe.label")}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setOutcome({ kind: "none" });
        }}
        multiline
        maxLength={MAX_DESCRIBE_CHARS}
        // a plain TextInput, so the phone keyboard's own dictation works (no voice code of ours); nothing typed is saved or learned
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        placeholder={t("symptom.describe.label")}
        placeholderTextColor={colors.muted}
        style={{ minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, color: colors.ink }}
      />
      <PrimaryButton title={t("symptom.describe.button")} disabled={text.trim().length === 0} onPress={find} />
      {outcome.kind === "match" && (
        <View accessibilityRole="alert" style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, color: colors.ink }}>{t("symptom.describe.match", "en", { name: labelOf(outcome.key) })}</Text>
          <PrimaryButton title={t("symptom.describe.match_yes")} onPress={() => onChoose(outcome.key)} />
          <SecondaryButton title={t("symptom.describe.match_no")} onPress={() => setOutcome({ kind: "none" })} />
        </View>
      )}
      {outcome.kind === "ambiguous" && (
        <View accessibilityRole="alert" style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, color: colors.ink }}>{t("symptom.describe.ambiguous")}</Text>
          {outcome.keys.map((k) => (
            <SecondaryButton key={k} title={labelOf(k)} onPress={() => onChoose(k)} />
          ))}
        </View>
      )}
      {outcome.kind === "no_match" && (
        <View accessibilityRole="alert">
          <MutedText>{t("symptom.describe.no_match")}</MutedText>
        </View>
      )}
    </View>
  );
}

export function WhyBlock({ explanation }: { explanation: Explanation }) {
  const colors = useLegacyColors();
  return (
    <View testID="why-this-result" style={{ gap: 6, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
      <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{t("symptom.why.title")}</Text>
      <MutedText>{t("symptom.why.intro")}</MutedText>
      {explanation.items.map((item) => (
        <View key={item.id} style={{ gap: 2 }}>
          <Text style={{ fontSize: 14, color: colors.ink }}>{item.reason}</Text>
          {item.youTold.length > 0 && <MutedText>{`${t("symptom.why.you_told")}:`}</MutedText>}
          {item.youTold.map((f, i) => (
            <MutedText key={i}>{`- ${explainerFactText(f, tr, label)}`}</MutedText>
          ))}
        </View>
      ))}
      {explanation.tellUsSooner.length > 0 && <MutedText>{`${t("symptom.why.sooner")}:`}</MutedText>}
      {explanation.tellUsSooner.map((l) => (
        <MutedText key={l}>{`- ${l}`}</MutedText>
      ))}
    </View>
  );
}

export function SafetyBlock({ net }: { net: SafetyNet }) {
  const colors = useLegacyColors();
  const { lines, closing } = safetyNetLines(net, tr);
  return (
    <View testID="safety-net" style={{ gap: 4, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
      <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{t("symptom.net.title")}</Text>
      {lines.map((l) => (
        <Text key={l} style={{ fontSize: 14, color: colors.ink }}>{`- ${l}`}</Text>
      ))}
      {closing.map((c) => (
        <MutedText key={c}>{c}</MutedText>
      ))}
    </View>
  );
}

/**
 * The save-this-card view: plain text to screenshot, share or read out. Shared-phone safe: it lives in component state only (no storage, no
 * file, no URL), and "Clear this screen" removes it and hands control back to the parent, which also forgets the result.
 */
export function SaveCard({ text, onClear }: { text: string; onClear: () => void }) {
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <SecondaryButton title={t("symptom.card.open")} onPress={() => setOpen((v) => !v)} />
      {open && (
        <View testID="save-card" style={{ gap: 6, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
          <MutedText>{t("symptom.card.hint")}</MutedText>
          <Text selectable style={{ fontSize: 14, color: colors.ink }}>{text}</Text>
          <SecondaryButton title={t("symptom.card.share")} onPress={() => void Share.share({ message: text }).catch(() => undefined)} />
          <MutedText>{t("symptom.card.shared_phone")}</MutedText>
        </View>
      )}
      <SecondaryButton
        title={t("symptom.card.clear")}
        onPress={() => {
          setOpen(false);
          onClear();
        }}
      />
    </View>
  );
}
