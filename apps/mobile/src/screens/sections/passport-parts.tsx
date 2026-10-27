import { Switch, View } from "react-native";
import { t } from "@tarragon/i18n";
import { failedLoadMessage, staleNotice } from "@/lib/passport-format";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, InlineAlert } from "@/ui/kit";

/** Shown above a copy that could not be refreshed: says why, and when the copy was saved. Never claims the copy is current. */
export function StaleNotice({ offline, savedAt }: { offline: boolean; savedAt: string | null }) {
  return <InlineAlert tone="info" message={staleNotice(offline, savedAt)} />;
}

/** A read that failed with nothing saved to fall back on. It says it failed (a lost connection or an error), never "nothing here". */
export function LoadFailed({ offline, refused = false, onRetry }: { offline: boolean; refused?: boolean; onRetry: () => void }) {
  // A refusal is not a glitch: asking again will not help, so the screen says access is not there instead of offering a retry loop.
  if (refused) return <InlineAlert tone="info" message={t("mpass.refused")} />;
  return (
    <View style={{ gap: space.md }}>
      <InlineAlert tone={offline ? "info" : "danger"} message={failedLoadMessage(offline)} />
      <Button title={t("common.try_again")} variant="secondary" onPress={onRetry} />
    </View>
  );
}

/** Screen heading: title and one plain sentence, announced as a header. */
export function PassportHeader({ title, description }: { title: string; description?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="headline" heading>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" tone="textMuted">
          {description}
        </AppText>
      ) : null}
    </View>
  );
}

/** A labelled on/off row: the label is read with the switch, the hint (if any) after it, and the row is at least 48 pt tall. */
export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (next: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 48 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body">{label}</AppText>
        {hint ? (
          <AppText variant="caption" tone="textMuted">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} accessibilityHint={hint} trackColor={{ true: colors.brand, false: colors.border }} />
    </View>
  );
}
