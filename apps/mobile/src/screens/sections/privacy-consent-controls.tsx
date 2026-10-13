import { useState } from "react";
import { Switch, Text, View } from "react-native";
import { receiptSentence, type ConsentReceiptRow } from "@tarragon/shared";
import { recordConsent, type ConsentRow } from "@/lib/privacy";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

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
  const colors = useLegacyColors();
  const [reading, setReading] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!row.isOptional) return null;

  async function run(action: "accepted" | "withdrawn") {
    setError(null);
    setBusy(true);
    const result = await recordConsent(organisationId, patientId, row.consentType, action);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReading(false);
    setTicked(false);
    setConfirming(false);
    onChanged();
  }

  if (row.state === "granted") {
    return (
      <View style={{ gap: 6 }}>
        {error && <ErrorText>{error}</ErrorText>}
        {confirming ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SecondaryButton title="Yes, withdraw" onPress={() => void run("withdrawn")} disabled={busy} />
            <SecondaryButton title="Keep it" onPress={() => setConfirming(false)} disabled={busy} />
          </View>
        ) : (
          <SecondaryButton title="Withdraw" onPress={() => setConfirming(true)} />
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {error && <ErrorText>{error}</ErrorText>}
      {reading ? (
        <>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{row.title}</Text>
          <Text style={{ fontSize: 12.5, color: colors.ink }}>{row.body}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch value={ticked} onValueChange={setTicked} accessibilityLabel="I have read this and I choose to agree" />
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.ink }}>I have read this and I choose to agree. I can stop at any time.</Text>
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your consent receipts</Text>
      <MutedText>Every time you agreed to something or stopped it: the exact words you saw, when, and where. Nothing here is ever removed.</MutedText>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : receipts.length === 0 ? (
        <MutedText>No receipts yet.</MutedText>
      ) : (
        receipts.map((r) => (
          <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 4 }}>
            <Text style={{ fontSize: 13, color: colors.ink }}>{receiptSentence(r)}</Text>
            {openId === r.id ? (
              <>
                <Text style={{ fontSize: 12.5, color: colors.ink }}>{r.body}</Text>
                <MutedText>Fingerprint of these words: {r.text_sha256}</MutedText>
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
