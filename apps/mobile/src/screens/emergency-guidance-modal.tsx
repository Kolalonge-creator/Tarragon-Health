import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/ui/theme";
import { SecondaryButton } from "@/ui/components";
import { getEmergencyNumbers } from "@/lib/nigeria-emergency-numbers";
import type { EmergencyContact } from "@/lib/emergency";

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
  /** Optional — only Lagos currently has a state-specific override; every
   * other state resolves to the national line either way. */
  state?: string | null;
  onDismiss: () => void;
}

export function EmergencyGuidanceModal({
  visible,
  detail,
  synced,
  emergencyContact,
  state,
  onDismiss,
}: EmergencyGuidanceModalProps) {
  const numbers = getEmergencyNumbers(state);

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
              backgroundColor: "#DC2626",
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
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>
              TarragonHealth does not provide emergency care. If this is a medical emergency, please{" "}
              <Text style={{ fontWeight: "700" }}>go to your nearest hospital or emergency department now</Text>,
              or call one of the numbers below.
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {numbers.map((n) => (
                <Pressable
                  key={n.tel}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${n.label}, ${n.number}`}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  onPress={() => Linking.openURL(`tel:${n.tel}`)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: "#DC2626",
                    borderRadius: radius.control,
                    minHeight: 44,
                    paddingVertical: 9,
                    paddingHorizontal: 14,
                  }}
                >
                  <Ionicons name="call" size={14} color="#FFFFFF" />
                  <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>
                    {n.label}: {n.number}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={{ fontSize: 13, color: colors.faint }}>Reported: {detail}</Text>

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
                backgroundColor: synced ? "#DCFCE7" : "#FEF3C7",
                borderRadius: radius.control,
                padding: 12,
              }}
            >
              <Text style={{ fontSize: 13, color: synced ? "#15803D" : "#B45309", lineHeight: 19 }}>
                {synced
                  ? "Your care team has been notified and will follow up."
                  : "We'll notify your care team as soon as you're back online. Call now if you need help sooner. Your reading is saved and won't be lost."}
              </Text>
            </View>

            <SecondaryButton title="I'm getting help" onPress={onDismiss} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
