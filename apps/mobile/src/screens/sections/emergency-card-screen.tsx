import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Share, Text, View } from "react-native";
import {
  createShareLink,
  loadActiveShareLink,
  loadCachedEmergencyFacts,
  loadEmergencyFacts,
  type EmergencyFacts,
  type ShareLink,
} from "@/lib/emergency";
import { colors, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

interface EmergencyCardScreenProps {
  patientId: string;
}

export function EmergencyCardScreen({ patientId }: EmergencyCardScreenProps) {
  const [facts, setFacts] = useState<EmergencyFacts | null>(null);
  const [offline, setOffline] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null | undefined>(undefined);
  // Distinguishes "no active link exists" (shareLink null) from "we don't
  // know" (fetch failed) — the latter must not render the create prompt over
  // a link that may already be live.
  const [shareLinkError, setShareLinkError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);

  const refreshShareLink = useCallback(() => {
    setShareLinkError(false);
    setShareLink(undefined);
    loadActiveShareLink(patientId)
      .then(setShareLink)
      .catch(() => setShareLinkError(true));
  }, [patientId]);

  useEffect(() => {
    loadEmergencyFacts(patientId)
      .then(setFacts)
      .catch(() => {
        setOffline(true);
        return loadCachedEmergencyFacts().then(setFacts);
      })
      .catch(() => {});
    refreshShareLink();
  }, [patientId, refreshShareLink]);

  async function handleCreateLink() {
    setCreating(true);
    setCreateError(false);
    const result = await createShareLink();
    if (result.error) {
      // Used to just stop the spinner with nothing said — the patient had
      // no way to know the link was never created.
      setCreateError(true);
    } else {
      refreshShareLink();
    }
    setCreating(false);
  }

  if (!facts) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Emergency card</Text>
      {offline ? <MutedText>You&apos;re offline, so this is your last saved copy.</MutedText> : null}

      <View style={{ backgroundColor: "#B91C1C", borderRadius: 14, padding: 16, gap: 10 }}>
        <Text style={{ fontWeight: "700", fontSize: 18, color: "#fff" }}>
          {facts.fullName ?? "—"}
        </Text>
        <FactRow label="Blood group" value={facts.bloodGroup ?? "Not on file"} />
        <FactRow label="Genotype" value={facts.genotype ?? "Not on file"} />
        <FactRow
          label="Allergies"
          value={facts.allergies.length > 0 ? facts.allergies.map((a) => a.allergen).join(", ") : "None on file"}
        />
        <FactRow label="Conditions" value={facts.conditions.length > 0 ? facts.conditions.join(", ") : "None on file"} />
        <FactRow
          label="Emergency contact"
          value={
            facts.emergencyContact
              ? `${facts.emergencyContact.name}${facts.emergencyContact.phone ? " · " + facts.emergencyContact.phone : ""}`
              : "Not on file"
          }
        />
      </View>

      <Card style={{ alignItems: "center", gap: 8 }}>
        {shareLinkError ? (
          <>
            <MutedText>We couldn&apos;t check your live link right now.</MutedText>
            <SecondaryButton title="Tap to retry" onPress={refreshShareLink} />
          </>
        ) : shareLink === undefined ? (
          <ActivityIndicator color={colors.brand} />
        ) : shareLink ? (
          <>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Your live link</Text>
            <Text selectable style={{ fontSize: 12, color: colors.brand, textAlign: "center" }}>
              {shareLink.url}
            </Text>
            <MutedText>
              Anyone with this link can view this card with no login, so share it only with people you trust to
              have it. Expires {new Date(shareLink.expiresAt).toLocaleDateString()}.
            </MutedText>
            <SecondaryButton title="Share link" onPress={() => void Share.share({ message: shareLink.url }).catch(() => {})} />
          </>
        ) : (
          <>
            <MutedText>
              Create a no-login link so a first responder can view this card without your phone unlocked.
            </MutedText>
            {createError ? (
              <ErrorText>We couldn&apos;t create the link just now. Please try again.</ErrorText>
            ) : null}
            <PrimaryButton title="Create a live link" onPress={handleCreateLink} loading={creating} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff", flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}
