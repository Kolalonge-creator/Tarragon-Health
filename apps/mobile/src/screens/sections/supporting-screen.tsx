import { CircleSupportingSection } from "./circle-supporting-section";
import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { loadPeopleISupport, startActingFor, type ActingFor, type SupportedPerson } from "@/lib/acting";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Badge, CalloutCard, Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { SupportingManageScreen } from "@/screens/sections/supporting-manage-screen";
import { SponsorSharingControl } from "@/screens/sections/sponsor-sharing-control";
import { AppText } from "@/ui/kit/AppText";
import { SegmentedControl } from "@/ui/kit/SegmentedControl";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";

interface SupportingScreenProps {
  userId: string;
  organisationId: string;
  acting: ActingFor | null;
  onActingChange: () => void;
  /** An account that only supports other people: no switch to "My health", which it does not have. */
  supporterOnly?: boolean;
  /** For an account that is both: the other half of the "My health / People I support" switch. */
  onOpenMyHealth?: () => void;
}

/**
 * Native "switch account" screen — the mechanism half of acting-for
 * (docs/uploads/MOBILE_APP_SPEC.md doesn't name this screen explicitly, but
 * the design's Overview mock implies it exists, and web already has the
 * full feature at /patient/supporting). Deliberately native rather than
 * WebView: web's "Open their account" writes an httpOnly cookie, which a
 * WebView's own separate cookie jar can't hand back to the native app's
 * session (see webview-screen.tsx) — so the switch itself has to happen in
 * native code. The richer billing/voucher management for people you support
 * (the "manage" modal below) is now SupportingManageScreen, a genuine native
 * read-only summary of vouchers/funding — see that file's own doc comment
 * for exactly which sub-flows (Paystack checkout, refills, booking,
 * messaging) still open the real web page in the system browser rather than
 * being rebuilt natively, and why.
 */
export function SupportingScreen({ userId, organisationId, acting, onActingChange, supporterOnly = false, onOpenMyHealth }: SupportingScreenProps) {
  const locale = asLocale(useUiLanguage());
  const colors = useLegacyColors();
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
      {!supporterOnly && onOpenMyHealth ? (
        <SegmentedControl
          options={[
            { value: "mine", label: t("supporterjoin.mode.mine", locale) },
            { value: "supporting", label: t("supporterjoin.mode.supporting", locale) },
          ]}
          value="supporting"
          onChange={(v) => {
            if (v === "mine") onOpenMyHealth();
          }}
          accessibilityLabel={t("supporterjoin.mode.label", locale)}
        />
      ) : null}

      <View style={{ gap: 4 }}>
        <AppText variant="title" accessibilityRole="header">People who share their care with you</AppText>
        <MutedText>Each person here chose to let you follow or help with their care. Open someone to see what they share.</MutedText>
      </View>

      {loadError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading the people you support"
          onPress={() => {
            setLoading(true);
            load()
              .catch(() => {})
              .finally(() => setLoading(false));
          }}
          style={{ minHeight: 44 }}
        >
          <Card style={{ gap: 6 }}>
            <AppText variant="bodyStrong">
              We couldn&apos;t load everyone right now
            </AppText>
            <MutedText>Check your connection and tap to try again.</MutedText>
          </Card>
        </Pressable>
      ) : null}

      <CircleSupportingSection
        managed={loading ? null : people}
        empty={
          loadError ? null : (
          <Card style={{ gap: 6 }}>
            <AppText variant="bodyStrong" accessibilityRole="header">
              No one has shared their care with you yet
            </AppText>
            <MutedText>
              When someone invites you to their Care Circle, they send you a link. Open it on this phone, accept, and they will appear here.
            </MutedText>
          </Card>
          )
        }
        renderManaged={(person) => {
          const name = person.fullName ?? "This person";
          const isOpen = acting?.profileId === person.profileId;
          return (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Badge tone={person.permissionLevel === "manage" ? "brand" : "neutral"}>
                  {person.permissionLevel === "manage" ? "You can act for them" : "You can follow"}
                </Badge>
                {person.isDependentAccount ? <Badge tone="neutral">Child</Badge> : null}
              </View>
              {person.permissionLevel === "manage" ? (
                isOpen ? (
                  <AppText variant="label" tone="brandText">
                    Currently open. See the banner above to switch back.
                  </AppText>
                ) : (
                  <SecondaryButton
                    title={`Open ${name}'s account`}
                    onPress={() => open(person)}
                    disabled={switching === person.profileId}
                  />
                )
              ) : null}
            </View>
          );
        }}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* The other half of the same relationship, on the same screen on
          purpose; mirrors web's /patient/supporting page, which renders
          SupportedPeople and SponsorSharingControl together. Someone who
          both supports a person and is supported by one should be able to
          see and change what they share without hunting through settings.
          Renders nothing when nobody is paying for this patient's care. */}
      <SponsorSharingControl organisationId={organisationId} />

      <CalloutCard
        icon="wallet-outline"
        title="Buy care for someone, and what you have funded"
        subtitle="Vouchers and statements for everyone you support open in the full patient app."
        ctaLabel="Manage what you fund"
        onPress={() => setManageOpen(true)}
      />

      <Modal visible={manageOpen} animationType="slide" onRequestClose={() => setManageOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setManageOpen(false)} />
          </View>
          <SupportingManageScreen userId={userId} />
        </View>
      </Modal>
    </ScrollView>
  );
}
