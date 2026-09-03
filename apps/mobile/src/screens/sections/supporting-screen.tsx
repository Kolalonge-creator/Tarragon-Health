import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { loadPeopleISupport, startActingFor, type ActingFor, type SupportedPerson } from "@/lib/acting";
import { colors, spacing } from "@/ui/theme";
import { Badge, CalloutCard, Card, ErrorText, MutedText, SectionLabel, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

interface SupportingScreenProps {
  userId: string;
  acting: ActingFor | null;
  onActingChange: () => void;
}

/**
 * Native "switch account" screen — the mechanism half of acting-for
 * (docs/uploads/MOBILE_APP_SPEC.md doesn't name this screen explicitly, but
 * the design's Overview mock implies it exists, and web already has the
 * full feature at /patient/supporting). Deliberately native rather than
 * WebView: web's "Open their account" writes an httpOnly cookie, which a
 * WebView's own separate cookie jar can't hand back to the native app's
 * session (see webview-screen.tsx) — so the switch itself has to happen in
 * native code, even though the richer billing/voucher management for people
 * you support stays a WebView link out, same low-frequency/form-heavy
 * reasoning as every other WEBVIEW section in the spec.
 */
export function SupportingScreen({ userId, acting, onActingChange }: SupportingScreenProps) {
  const [people, setPeople] = useState<SupportedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setPeople(await loadPeopleISupport(userId));
    } catch {
      setLoadError(true);
    }
  }, [userId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function open(person: SupportedPerson) {
    setSwitching(person.profileId);
    setError(null);
    const ok = await startActingFor(person.profileId);
    setSwitching(null);
    if (!ok) {
      setError("You don't have permission to open this person's account.");
      return;
    }
    onActingChange();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>People you support</Text>
        <MutedText>Open someone&apos;s account to log a reading or run an errand for them.</MutedText>
      </View>

      <SectionLabel>People you support</SectionLabel>

      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : loadError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading the people you support"
          onPress={() => {
            setLoading(true);
            load()
              .catch(() => {})
              .finally(() => setLoading(false));
          }}
        >
          <Card style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>
              We couldn&apos;t load this right now
            </Text>
            <MutedText>Check your connection and tap to try again.</MutedText>
          </Card>
        </Pressable>
      ) : people.length === 0 ? (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>
            You are not supporting anyone yet
          </Text>
          <MutedText>
            Once someone accepts a request to let you help manage their care, they appear here.
          </MutedText>
        </Card>
      ) : (
        people.map((person) => {
          const name = person.fullName ?? "This person";
          const isOpen = acting?.profileId === person.profileId;
          return (
            <Card key={person.profileId} style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, flexShrink: 1 }}>{name}</Text>
                <Badge tone={person.permissionLevel === "manage" ? "brand" : "neutral"}>
                  {person.permissionLevel === "manage" ? "You can act for them" : "You can follow"}
                </Badge>
                {person.isDependentAccount ? <Badge tone="neutral">Child</Badge> : null}
              </View>
              {person.permissionLevel === "manage" ? (
                isOpen ? (
                  <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.brand }}>
                    Currently open. See the banner above to switch back.
                  </Text>
                ) : (
                  <SecondaryButton
                    title={`Open ${name}'s account`}
                    onPress={() => open(person)}
                    disabled={switching === person.profileId}
                  />
                )
              ) : (
                <MutedText>
                  You can follow how {name} is doing, if they&apos;ve shared that with you, but you
                  cannot act for them.
                </MutedText>
              )}
            </Card>
          );
        })
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <CalloutCard
        icon="wallet-outline"
        title="What you've funded"
        subtitle="Vouchers and statements for everyone you support open in the full patient app."
        ctaLabel="Manage what you fund"
        onPress={() => setManageOpen(true)}
      />

      <Modal visible={manageOpen} animationType="slide" onRequestClose={() => setManageOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setManageOpen(false)} />
          </View>
          <WebViewScreen path="/patient/supporting" />
        </View>
      </Modal>
    </ScrollView>
  );
}
