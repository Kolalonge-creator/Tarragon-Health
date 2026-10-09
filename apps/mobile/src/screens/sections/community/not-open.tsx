import { AppText, Screen } from "@/ui/kit";
import { useCopy } from "./common";

/** The one calm line shown when Community is reached but is not available to this account right now. */
export function CommunityNotOpen() {
  const copy = useCopy();
  return (
    <Screen>
      <AppText variant="body" tone="textMuted">
        {copy("community.not_open")}
      </AppText>
    </Screen>
  );
}
