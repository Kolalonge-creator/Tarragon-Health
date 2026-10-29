import { useCallback, useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { answerProxyReview, dueReviews, loadProxyReviews, reviewCategoryLabel, type ProxyReviewRow } from "@/lib/proxy-review";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

type Mode = "idle" | "narrowing" | "confirming_remove";

function ReviewItem({ row, onAnswered }: { row: ProxyReviewRow; onAnswered: (message: string) => void }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [keep, setKeep] = useState<string[]>(row.categories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "keep" | "narrow" | "remove") {
    setBusy(true);
    setError(null);
    const out = await answerProxyReview(row.granteeId, action === "narrow" ? { action, keep } : { action });
    setBusy(false);
    if (out.ok) {
      setMode("idle");
      onAnswered(
        action === "keep"
          ? `Thank you. ${row.firstName} keeps their access, and we will ask again in a year.`
          : action === "narrow"
            ? `Saved. ${row.firstName} can now see less.`
            : `${row.firstName}'s access has stopped.`,
      );
      return;
    }
    setError(
      out.reason === "changed"
        ? "What they can see has changed since this screen loaded. Close it and open it again, or remove their access."
        : "We could not save that just now. Nothing has changed. Please try again.",
    );
  }

  const changed = keep.length !== row.categories.length;

  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      <AppText variant="bodyStrong">{row.firstName} can still see your health information.</AppText>
      <MutedText>
        {row.categories.length > 0
          ? `What they can see: ${row.categories.map(reviewCategoryLabel).join(", ")}.`
          : "They can see what you have shared with them."}
      </MutedText>
      {row.daysOverdue > 0 ? <MutedText>This has been waiting a while. There is no rush, and nothing changes unless you choose.</MutedText> : null}

      {mode === "idle" && (
        <View style={{ gap: 8 }}>
          <PrimaryButton title="Keep as it is" onPress={() => void send("keep")} loading={busy} />
          {row.categories.length > 0 && <SecondaryButton title="Let them see less" disabled={busy} onPress={() => setMode("narrowing")} />}
          <SecondaryButton title="Remove their access" disabled={busy} onPress={() => setMode("confirming_remove")} />
        </View>
      )}

      {mode === "narrowing" && (
        <View style={{ gap: 8 }}>
          <MutedText>Turn off what they no longer need to see. They are not told. To stop all of it, choose Remove their access instead.</MutedText>
          {row.categories.map((category) => (
            <View key={category} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <AppText variant="body" style={{ flex: 1 }}>{reviewCategoryLabel(category)}</AppText>
              <Switch
                value={keep.includes(category)}
                onValueChange={(on) => setKeep((cur) => (on ? [...cur, category] : cur.filter((c) => c !== category)))}
                accessibilityLabel={reviewCategoryLabel(category)}
              />
            </View>
          ))}
          <PrimaryButton title="Save" disabled={!changed || keep.length === 0 || busy} loading={busy} onPress={() => void send("narrow")} />
          <SecondaryButton title="Back" disabled={busy} onPress={() => setMode("idle")} />
        </View>
      )}

      {mode === "confirming_remove" && (
        <View style={{ gap: 8 }}>
          <AppText variant="body">
            Remove {row.firstName}&apos;s access now? They will not be able to see anything of yours. They are not told.
          </AppText>
          <PrimaryButton title="Yes, remove it" loading={busy} onPress={() => void send("remove")} />
          <SecondaryButton title="No, go back" disabled={busy} onPress={() => setMode("idle")} />
        </View>
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/**
 * The yearly check (NHS proxy-access standard: grant, redact, review, revoke), on the phone. Lists every grant whose review is due with three
 * answers. Not answering never removes anything; the item stays here until the person answers. Renders nothing when no one is due.
 */
export function ProxyReviewCard() {
  const colors = useLegacyColors();
  const [rows, setRows] = useState<ProxyReviewRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);

  const load = useCallback(async () => {
    const out = await loadProxyReviews();
    if (out.ok) {
      setRows(out.rows);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <Card style={{ gap: 6 }}>
        <AppText variant="bodyStrong">Yearly check on who can help you</AppText>
        <MutedText>We could not load this just now. Please try again later. Nobody&apos;s access has changed.</MutedText>
      </Card>
    );
  }
  if (rows === null) return null;
  const due = dueReviews(rows);
  if (due.length === 0 && notices.length === 0) return null;

  return (
    <Card style={{ gap: 6 }}>
      <AppText variant="bodyStrong">Yearly check on who can help you</AppText>
      <MutedText>Once a year we ask whether the people who help you still need access. Nothing changes unless you choose.</MutedText>
      {notices.map((notice) => (
        <Text key={notice} style={{ color: colors.ink }} accessibilityRole="alert">
          {notice}
        </Text>
      ))}
      {due.map((row) => (
        <ReviewItem
          key={row.grantId}
          row={row}
          onAnswered={(message) => {
            setNotices((cur) => [...cur, message]);
            void load();
          }}
        />
      ))}
    </Card>
  );
}
