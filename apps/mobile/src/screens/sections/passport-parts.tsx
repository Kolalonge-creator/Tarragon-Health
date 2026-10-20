import { View } from "react-native";
import { t } from "@tarragon/i18n";
import { failedLoadMessage, staleNotice } from "@/lib/passport-format";
import { space } from "@/ui/design";
import { AppText, Button, InlineAlert } from "@/ui/kit";

/** Shown above a copy that could not be refreshed: says why, and when the copy was saved. Never claims the copy is current. */
export function StaleNotice({ offline, savedAt }: { offline: boolean; savedAt: string | null }) {
  return <InlineAlert tone="info" message={staleNotice(offline, savedAt)} />;
}

/** A read that failed with nothing saved to fall back on. It says it failed (a lost connection or an error), never "nothing here". */
export function LoadFailed({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
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
