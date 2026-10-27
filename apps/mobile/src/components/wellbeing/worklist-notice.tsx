import { useState } from "react";
import { Switch, Text, View } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText } from "@/ui/legacy-kit";

const tr = (key: string) => t(key as MessageKey, "en");

/** What the care team's follow-up list uses, in plain words, with an opt-out for check-in activity and the sleep diary (S56b). Shown once the list is on. */
export function WorklistNotice({ enabled, optedOut }: { enabled: boolean; optedOut: boolean }) {
  const colors = useLegacyColors();
  const [value, setValue] = useState(optedOut);
  const [failed, setFailed] = useState(false);
  if (!enabled) return null;
  async function change(next: boolean) {
    setFailed(false);
    const { error } = await supabase.rpc("set_worklist_activity_opt_out", { p_opt_out: next });
    if (error) setFailed(true);
    else setValue(next);
  }
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 13.5, color: colors.ink }}>{tr("wnotice.text")}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Switch accessibilityLabel={tr("wnotice.opt_out")} value={value} onValueChange={(v) => void change(v)} />
        <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink }}>{tr("wnotice.opt_out")}</Text>
      </View>
      <MutedText>{tr("wnotice.opt_out_note")}</MutedText>
      {failed && <ErrorText>{tr("wnotice.error")}</ErrorText>}
    </Card>
  );
}
