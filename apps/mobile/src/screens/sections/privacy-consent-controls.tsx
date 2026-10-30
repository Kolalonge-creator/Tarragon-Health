import { useState } from "react";
import { Switch, View } from "react-native";
import { receiptSentence, type ConsentReceiptRow } from "@tarragon/shared";
import { recordConsent, type ConsentRow } from "@/lib/privacy";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

/**
 * Give or withdraw one OPTIONAL consent (S04b-2). Nothing starts ticked: the person reads the words, ticks one switch for this
 * one purpose, then taps Agree. Withdrawing takes two taps. A required purpose gets no control here at all.
 */
export function OptionalConsentControls({
  row,
  organisationId,
  patientId,
  onChanged,
}: {
  row: ConsentRow;
  organisationId: string;
  patientId: string;
  onChanged: () => void;
}) {
  const [reading, setReading] = useState(false);
  // The tick belongs to the version that was on screen when it was made; a replaced version starts unticked.
  const [tickedFor, setTickedFor] = useState<string | null>(null);
  const ticked = tickedFor === row.versionId;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!row.isOptional) return null;

  async function run(action: "accepted" | "withdrawn") {
    setError(null);
    setBusy(true);
    const result = await recordConsent(organisationId, patientId, row.consentType, action, row.versionId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReading(false);
    setTickedFor(null);
    setConfirming(false);
    onChanged();
  }

  // In force (this version or an older one): the person can always withdraw. If the wording has been replaced they can also read the new words.
  const inForce = row.state === "granted" || row.state === "older_version";
  const canRead = row.state !== "granted";

  return (
    <View style={{ gap: 8 }}>
      {error && <ErrorText>{error}</ErrorText>}
      {inForce &&
        (confirming ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SecondaryButton title="Yes, withdraw" onPress={() => void run("withdrawn")} disabled={busy} />
            <SecondaryButton title="Keep it" onPress={() => setConfirming(false)} disabled={busy} />
          </View>
        ) : (
          <SecondaryButton title="Withdraw" onPress={() => setConfirming(true)} />
        ))}
      {!canRead ? null : reading ? (
        <>
          <AppText variant="label">{row.title}</AppText>
          <AppText variant="body">{row.body}</AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch value={ticked} onValueChange={(on) => setTickedFor(on ? row.versionId : null)} accessibilityLabel="I have read this and I choose to agree" />
            <AppText variant="body" style={{ flex: 1 }}>I have read this and I choose to agree. I can stop at any time.</AppText>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Agree" onPress={() => void run("accepted")} disabled={!ticked} loading={busy} />
            <SecondaryButton title="Not now" onPress={() => setReading(false)} disabled={busy} />
          </View>
        </>
      ) : (
        <SecondaryButton title="Read and decide" onPress={() => setReading(true)} />
      )}
    </View>
  );
}

/** The consent receipts: who, what, which version, when and where, with the exact words on demand. Append-only evidence. */
export function ConsentReceiptsCard({ receipts, error }: { receipts: ConsentReceiptRow[]; error: string | null }) {
  const colors = useLegacyColors();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="bodyStrong">Your consent receipts</AppText>
      <MutedText>Every time you agreed to something or stopped it: the exact words you saw, when, and where. Nothing here is ever removed.</MutedText>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : receipts.length === 0 ? (
        <MutedText>No receipts yet.</MutedText>
      ) : (
        receipts.map((r) => (
          <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 4 }}>
            <AppText variant="body">{receiptSentence(r)}</AppText>
            {openId === r.id ? (
              <>
                <AppText variant="body">{r.body}</AppText>
                <MutedText>
                  {r.text_sha256
                    ? `Fingerprint of these words: ${r.text_sha256}`
                    : "These are the words on file for that version. This record pre-dates receipts, so it has no fingerprint."}
                </MutedText>
                <SecondaryButton title="Hide the words" onPress={() => setOpenId(null)} />
              </>
            ) : (
              <SecondaryButton title="Show the exact words" onPress={() => setOpenId(r.id)} />
            )}
          </View>
        ))
      )}
    </Card>
  );
}
