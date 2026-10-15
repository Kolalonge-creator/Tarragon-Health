import { useState } from "react";
import { View } from "react-native";
import { askQuestion } from "@/lib/community/api";
import { fromSubmit, type ComposerEffect } from "@/lib/community/compose";
import type { QaSession } from "@/lib/community/model";
import { space } from "@/ui/design";
import { AppText, Badge, Button } from "@/ui/kit";
import { Composer } from "./composer";
import { Section, formatDateTime, useCopy } from "./common";

/**
 * "Ask the doctors": a question session for this group. Shows its status, the named doctors, the not-medical-advice sentence and, while
 * the session is open and the member is in the group, a form to ask (with how many questions are left). The limit comes from the
 * database reply. A question is a post; it appears in the feed with a badge and, once answered, the doctor's real name.
 */
export function QaCard({
  groupId,
  qa,
  maxChars,
  canAsk,
  onAsked,
  onSafety,
}: {
  groupId: string;
  qa: QaSession;
  maxChars: number;
  /** An active member with current rules in an open group. */
  canAsk: boolean;
  onAsked: () => void;
  onSafety: (kind: "emergency" | "self_harm") => void;
}) {
  const copy = useCopy();
  const [asking, setAsking] = useState(false);
  const remaining = Math.max(0, qa.question_limit - qa.my_questions);

  const statusLine =
    qa.status === "upcoming"
      ? copy("community.qa.upcoming", { time: formatDateTime(qa.opens_at) })
      : qa.status === "open"
        ? copy("community.qa.open", { time: formatDateTime(qa.closes_at) })
        : copy("community.qa.closed");

  function afterAsk(effect: ComposerEffect) {
    if (effect.safety) onSafety(effect.safety);
    if (effect.refresh) {
      setAsking(false);
      onAsked();
    }
  }

  return (
    <Section title={qa.title || copy("community.qa.title")}>
      <Badge label={copy("community.qa.title")} tone={qa.status === "open" ? "positive" : "neutral"} />
      {qa.intro ? <AppText variant="body">{qa.intro}</AppText> : null}
      <AppText variant="bodyStrong">{statusLine}</AppText>
      {qa.doctors.length > 0 ? <AppText variant="body">{copy("community.qa.doctors", { names: qa.doctors.join(", ") })}</AppText> : null}
      <AppText variant="caption" tone="textMuted">
        {copy("community.qa.not_advice")}
      </AppText>

      {qa.status === "open" && canAsk ? (
        <View style={{ gap: space.sm }}>
          {remaining > 0 ? (
            asking ? (
              <>
                <Composer
                  maxChars={maxChars}
                  label="community.qa.ask"
                  placeholder="community.qa.ask_placeholder"
                  submitLabel="community.qa.send"
                  submit={async ({ body, clientRequestId }) => fromSubmit(await askQuestion({ groupId, sessionId: qa.session_id, body, clientRequestId }))}
                  onEffect={afterAsk}
                />
                <AppText variant="caption" tone="textMuted">
                  {copy("community.qa.remaining", { count: remaining })}
                </AppText>
              </>
            ) : (
              <>
                <Button title={copy("community.qa.ask")} onPress={() => setAsking(true)} fullWidth={false} />
                <AppText variant="caption" tone="textMuted">
                  {copy("community.qa.remaining", { count: remaining })}
                </AppText>
              </>
            )
          ) : (
            <AppText variant="body" tone="textMuted">
              {copy("community.compose.refused.qa_limit")}
            </AppText>
          )}
        </View>
      ) : null}
    </Section>
  );
}
