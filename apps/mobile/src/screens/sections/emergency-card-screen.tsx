import { useEffect, useState } from "react";
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
import { Card, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

interface EmergencyCardScreenProps {
  patientId: string;
}

export function EmergencyCardScreen({ patientId }: EmergencyCardScreenProps) {
  const [facts, setFacts] = useState<EmergencyFacts | null>(null);
  const [offline, setOffline] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadEmergencyFacts(patientId)
      .then(setFacts)
      .catch(() => {
        setOffline(true);
        return loadCachedEmergencyFacts().then(setFacts);
      });
    loadActiveShareLink(patientId).then(setShareLink);
  }, [patientId]);

  async function handleCreateLink() {
    setCreating(true);
    const result = await createShareLink();
    if (!result.error) {
      setShareLink(await loadActiveShareLink(patientId));
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
      {offline ? <MutedText>Showing your last saved copy — you&apos;re offline.</MutedText> : null}

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
        {shareLink === undefined ? (
          <ActivityIndicator color={colors.brand} />
        ) : shareLink ? (
          <>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Your live link</Text>
            <Text selectable style={{ fontSize: 12, color: colors.brand, textAlign: "center" }}>
              {shareLink.url}
            </Text>
            <MutedText>
              Anyone with this link can view this card with no login — share it only with people you trust to have
              it. Expires {new Date(shareLink.expiresAt).toLocaleDateString()}.
            </MutedText>
            <SecondaryButton title="Share link" onPress={() => Share.share({ message: shareLink.url })} />
          </>
        ) : (
          <>
            <MutedText>
              Create a no-login link so a first responder can view this card without your phone unlocked.
            </MutedText>
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
