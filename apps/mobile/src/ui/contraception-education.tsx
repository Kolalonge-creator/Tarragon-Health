import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { cycleCopy, t } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { useLegacyColors } from "@/ui/design";
import { MutedText } from "@/ui/legacy-kit";

/**
 * Neutral contraception education (S66, 16.3, decision A13): an alphabetical list with one factual line each, no ranking, no dosing, no
 * advice on which to choose, fertility awareness never presented as contraception, and a single route to the care team. Words are in
 * packages/i18n (proposed, CMO review pending). Behind the go-live guard `reproductive_content_enabled` (OFF); a failed check is "closed".
 */
const METHOD_KEYS = (Object.keys(cycleCopy) as (keyof typeof cycleCopy)[]).filter((k) => k.startsWith("contraception.edu.method."));

export function ContraceptionEducation() {
  const colors = useLegacyColors();
  const [open, setOpen] = useState<boolean | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    void supabase.rpc("go_live_guard_is_open", { p_key: "reproductive_content_enabled" }).then(({ data, error }) => setOpen(!error && data === true));
  }, []);
  if (open === null) return null;
  if (!open) return <MutedText>{t("contraception.edu.closed")}</MutedText>;
  return (
    <View style={{ gap: 8 }}>
      <Text onPress={() => setShown(!shown)} style={{ fontSize: 13, fontWeight: "700", color: colors.brandPressed }}>
        {shown ? "Hide the options" : t("contraception.edu.title")}
      </Text>
      {shown && (
        <>
          <MutedText>{t("contraception.edu.intro")}</MutedText>
          <MutedText>{t("contraception.edu.not_tracking")}</MutedText>
          {METHOD_KEYS.map((k) => (
            <Text key={k} style={{ fontSize: 13, color: colors.ink }}>
              {"• "}
              {t(k)}
            </Text>
          ))}
          <MutedText>{t("contraception.edu.cautions")}</MutedText>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{t("contraception.edu.emergency_title")}</Text>
          <MutedText>{t("contraception.edu.emergency_body")}</MutedText>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{t("contraception.edu.refer_title")}</Text>
          <MutedText>{t("contraception.edu.refer_body")}</MutedText>
        </>
      )}
    </View>
  );
}
