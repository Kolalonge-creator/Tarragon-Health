import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/ui/theme";
import { PrimaryButton, SecondaryButton } from "@/ui/components";

const PRIVACY_POLICY_URL = "https://tarragonhealth.ng/privacy";

/**
 * Health Connect's own permissions-rationale requirement, satisfied in the
 * app's own UI rather than only in the Play Console declaration form: shown
 * once, before the OS permission request ever fires, explaining exactly
 * what TarragonHealth reads from Health Connect, that it never writes
 * anything back, and linking to the privacy policy. See
 * health-connect-consent.ts for why this needs to be a real screen rather
 * than relying on the same `NSHealthShareUsageDescription`-style single
 * string HealthKit's own bridge gets away with on iOS.
 *
 * `onAccept` is the only path that leads to the native permission dialog —
 * android-health-connect-card.tsx calls
 * `markHealthConnectRationaleAccepted()` there before starting the sync
 * that actually calls `requestHealthConnectPermissions()`.
 * `onDecline`/`onRequestClose` leave the rationale-accepted flag untouched,
 * so it is shown again the next time the patient taps Sync.
 */
export interface HealthConnectRationaleModalProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function HealthConnectRationaleModal({
  visible,
  onAccept,
  onDecline,
}: HealthConnectRationaleModalProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDecline}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.screen, gap: 14 }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: colors.brandTintAlt,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="fitness-outline" size={24} color={colors.brand} />
        </View>

        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>
          Share Health Connect data with TarragonHealth?
        </Text>

        <Text style={{ fontSize: 14.5, lineHeight: 21, color: colors.ink }}>
          Before Android asks you to choose which permissions to grant, here is exactly what that
          will let us read and why:
        </Text>

        <View style={{ gap: 10 }}>
          <RationaleRow
            icon="heart-outline"
            text="Blood pressure, blood sugar, weight, oxygen level, heart rate variability, and resting heart rate you or another app have logged in Health Connect."
          />
          <RationaleRow icon="walk-outline" text="Daily step count." />
          <RationaleRow
            icon="time-outline"
            text="Past readings going back further than the usual 30 days (so your first sync isn't missing recent history), and readings that arrive while TarragonHealth isn't open, so nothing is missed between visits."
          />
        </View>

        <View style={{ backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 12, gap: 6 }}>
          <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 20 }}>
            We only read this data — TarragonHealth never writes anything back to Health Connect.
            Your care team sees it alongside the rest of your record, the same as a reading you
            type in yourself. You choose exactly which of these Android lets you grant on the next
            screen, and you can change or revoke any of them later in Health Connect's own app
            settings.
          </Text>
        </View>

        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}
          hitSlop={8}
        >
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.brand }}>
            Read our privacy policy
          </Text>
        </Pressable>

        <View style={{ gap: 10, marginTop: 8 }}>
          <PrimaryButton title="Continue" onPress={onAccept} />
          <SecondaryButton title="Not now" onPress={onDecline} />
        </View>
      </ScrollView>
    </Modal>
  );
}

function RationaleRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Ionicons name={icon} size={18} color={colors.brand} style={{ marginTop: 2 }} />
      <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.ink }}>{text}</Text>
    </View>
  );
}
