import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/ui/theme";
import { SecondaryButton } from "@/ui/components";
import type { EmergencyContact } from "@/lib/emergency";
import { ListenButton } from "@/ui/kit";
import { t, type MessageKey } from "@tarragon/i18n";
import { redGuidanceStatus } from "@/lib/red-guidance-copy";
import { PLATFORM_URL } from "@/lib/platform-url";

/**
 * Native, zero-network "go to the nearest hospital now" safety net for a
 * locally red-flagged BP/glucose reading (see glucose-red-flags.ts,
 * bp-classification.ts). All copy and the Nigeria emergency-number list are
 * bundled in the binary — nothing here is fetched, so it renders instantly
 * with no signal at all, unlike the web EmergencyAlert (apps/web/src/app/
 * (dashboard)/patient/emergency-alert.tsx), which today only reaches mobile
 * through a WebView that itself requires network.
 *
 * Deliberately does NOT create or acknowledge a server-side emergency_events
 * row — that stays entirely server-side, driven by the same red-flag
 * pipeline (assessGlucoseBestEffort / the BP DB trigger) that already fires
 * once this reading actually syncs. This modal is a client-only rendering
 * layer on top of a locally-computed flag, not a second source of truth.
 */
export interface EmergencyGuidanceModalProps {
  visible: boolean;
  detail: string;
  /** Whether the triggering reading has actually reached the server yet —
   * changes the copy from "queued" to "notified" honestly, no state of its
   * own beyond what the caller already knows from the queue/flush result. */
  synced: boolean;
  emergencyContact: EmergencyContact | null;
  /** EMG-001 or EMG-001L: show those words (the same ones the voice says) and a Listen button. Null keeps the generic text. */
  wordingCode?: string | null;
  /** Two-tier (CMO 2026-10-08): whether a red event reaches a doctor for this patient (a Member). True says the care team was told, false says in plain words that no doctor was alerted on the Free plan, null (unknown) makes no claim. */
  doctorReview?: boolean | null;
  onDismiss: () => void;
}

export function EmergencyGuidanceModal({
  visible,
  detail,
  synced,
  emergencyContact,
  wordingCode = null,
  doctorReview = null,
  onDismiss,
}: EmergencyGuidanceModalProps) {
  const status = redGuidanceStatus(doctorReview, synced, !!emergencyContact?.phone);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(18,50,75,0.7)",
          justifyContent: "center",
          padding: spacing.screen,
        }}
      >
        <View style={{ backgroundColor: "#FFFFFF", borderRadius: radius.card, maxHeight: "85%" }}>
          <View
            style={{
              backgroundColor: colors.status.emergency,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              paddingVertical: 18,
              paddingHorizontal: spacing.screen,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Ionicons name="warning" size={26} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700", flexShrink: 1 }}>
              This may be a medical emergency
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
            {wordingCode ? (
              <>
                <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink, fontWeight: "700" }}>
                  {t(`triage.${wordingCode.toLowerCase()}.body`.replace("-", "_") as MessageKey, "en")}
                </Text>
                <ListenButton clipIds={[wordingCode]} lang="en" />
              </>
            ) : null}
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>
              TarragonHealth does not provide emergency care. If this is a medical emergency, please{" "}
              <Text style={{ fontWeight: "700" }}>go to your nearest hospital or emergency department now.</Text>
              {" "}Nigeria has no single reliable emergency number to call instead — going in person is
              the fastest, surest way to get help.
            </Text>

            <Text style={{ fontSize: 13, color: colors.subtle }}>Reported: {detail}</Text>

            {emergencyContact?.phone ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call your emergency contact ${emergencyContact.name}, ${emergencyContact.relationship ?? "emergency contact"}`}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                onPress={() => Linking.openURL(`tel:${emergencyContact.phone}`)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.control,
                  minHeight: 44,
                  paddingVertical: 11,
                  paddingHorizontal: 14,
                }}
              >
                <Ionicons name="call-outline" size={16} color={colors.ink} />
                <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flexShrink: 1 }}>
                  Call {emergencyContact.name} ({emergencyContact.relationship ?? "emergency contact"})
                </Text>
              </Pressable>
            ) : null}

            <View
              style={{
                backgroundColor: status.tone === "ok" ? "#DCFCE7" : status.tone === "warn" ? colors.status.warnBg : "#F1F5F9",
                borderRadius: radius.control,
                padding: 12,
                gap: 6,
              }}
            >
              {status.lines.map((line) => (
                <Text
                  key={line}
                  style={{ fontSize: 13, color: status.tone === "ok" ? "#15803D" : status.tone === "warn" ? colors.status.warn : colors.ink, lineHeight: 19 }}
                >
                  {line}
                </Text>
              ))}
            </View>

            {status.showJoin ? (
              <View style={{ gap: 6 }}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t("freered.join", "en")}
                  onPress={() => Linking.openURL(`${PLATFORM_URL}/patient/membership`)}
                  style={{ minHeight: 44, borderRadius: radius.control, backgroundColor: colors.brand, paddingVertical: 11, paddingHorizontal: 14, justifyContent: "center" }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>{t("freered.join", "en")}</Text>
                </Pressable>
                <Text style={{ fontSize: 12, color: colors.subtle }}>{t("freered.join_hint", "en")}</Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL("https://www.google.com/maps/search/hospital+near+me")}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{t("freered.facility", "en")}</Text>
                </Pressable>
              </View>
            ) : null}

            <SecondaryButton title="I'm getting help" onPress={onDismiss} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
