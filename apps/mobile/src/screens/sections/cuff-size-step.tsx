import { useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { cuffSizeKey, isPlausibleArmCm } from "@tarragon/clinical";
import { useUiLanguage } from "@/lib/ui-language";
import { loadCuffGuidance, saveCuff, type CuffDeviceList, type CuffGuidance } from "@/lib/cuff-guidance";
import { CUFF_TYPES, type CuffType } from "@/lib/bp-checklist";
import { space } from "@/ui/design";
import { AppText, Button, Field, InlineAlert, SegmentedControl } from "@/ui/kit";

/**
 * The cuff size check inside the home check's cuff guide (S07y). It appears only when the Chief Medical Officer has signed the cuff size table
 * (the server answers nothing before that), looks the typed arm measurement up in that signed table, and lets the person record which cuff she uses.
 * It is a guide: it never grades a reading and never says a model is "bad". A failed read or save shows a plain line and nothing else changes.
 */
export function CuffSizeStep() {
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
  const [guidance, setGuidance] = useState<CuffGuidance | null>(null);
  const [cuffType, setCuffType] = useState<CuffType>("upper_arm");
  const [model, setModel] = useState("");
  const [armText, setArmText] = useState("");
  const [shownCm, setShownCm] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "failed" | null>(null);
  const [listed, setListed] = useState<CuffDeviceList>(null);

  useEffect(() => {
    let live = true;
    void loadCuffGuidance().then((g) => {
      if (!live || !g) return;
      setGuidance(g);
      if (g.cuff) {
        setCuffType(g.cuff.cuffType);
        setModel(g.cuff.model ?? "");
        setListed(g.cuff.deviceList);
        if (g.cuff.armCm !== null) {
          setArmText(String(g.cuff.armCm));
          setShownCm(g.cuff.armCm);
        }
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (!guidance) return null;
  const cfg = guidance.config;
  const parsedArm = Number(armText.replace(",", "."));
  const armCm = armText.trim() === "" ? null : parsedArm;

  const check = () => {
    if (armCm === null || !isPlausibleArmCm(armCm, cfg)) {
      setInvalid(true);
      setShownCm(null);
      return;
    }
    setInvalid(false);
    setShownCm(armCm);
  };

  const save = async () => {
    if (armCm !== null && !isPlausibleArmCm(armCm, cfg)) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setNotice(null);
    const out = await saveCuff({ cuffType, model, armCm });
    setBusy(false);
    if (out.kind === "saved") {
      setNotice("saved");
      setListed(out.deviceList);
    } else {
      setNotice("failed");
    }
  };

  const sizeLine = (() => {
    if (shownCm === null) return null;
    const key = cuffSizeKey(shownCm, cfg);
    if (key === "below_range") return tr("hc.cuff.size_below");
    if (key === "above_range") return tr("hc.cuff.size_above");
    return tr("hc.cuff.size_result", { cm: shownCm, size: tr(`hc.cuff.size.${key}` as MessageKey) });
  })();

  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="bodyStrong" heading>
        {tr("hc.cuff.size_title")}
      </AppText>
      <AppText variant="body">{tr("hc.cuff.size_intro")}</AppText>
      <Field label={tr("hc.cuff.size_input")} value={armText} onChangeText={setArmText} keyboardType="decimal-pad" maxLength={5} error={invalid ? tr("hc.cuff.size_invalid") : null} />
      <Button variant="secondary" fullWidth={false} title={tr("hc.cuff.size_check")} onPress={check} />
      {sizeLine ? <AppText variant="bodyStrong">{sizeLine}</AppText> : null}

      <AppText variant="label" tone="textMuted">
        {tr("hc.cuff.type_label")}
      </AppText>
      <SegmentedControl
        accessibilityLabel={tr("hc.cuff.type_label")}
        options={CUFF_TYPES.map((v) => ({ value: v, label: tr(`hc.cuff.type.${v}` as MessageKey) }))}
        value={cuffType}
        onChange={setCuffType}
      />
      <Field label={tr("hc.cuff.model_label")} value={model} onChangeText={setModel} maxLength={80} autoCapitalize="words" />
      {listed ? <AppText variant="caption" tone="textMuted">{tr(`hc.cuff.list.${listed}` as MessageKey)}</AppText> : null}
      {notice === "saved" ? <InlineAlert tone="info" message={tr("hc.cuff.saved")} /> : null}
      {notice === "failed" ? <InlineAlert tone="warn" message={tr("hc.cuff.save_failed")} /> : null}
      <Button title={tr("hc.cuff.save")} disabled={busy} onPress={() => void save()} />
    </View>
  );
}
