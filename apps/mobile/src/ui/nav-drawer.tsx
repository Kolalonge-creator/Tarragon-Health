import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { SECTIONS, SECTION_GROUP_ORDER, type SectionId } from "@/lib/sections";
import { colors, spacing } from "./theme";
import { QuickActionButton, QuickActionGrid, SectionDivider, SectionLabel } from "./components";

interface NavDrawerProps {
  visible: boolean;
  activeSection: SectionId;
  patientName: string;
  patientNumber: string | null;
  initials: string;
  onSelect: (id: SectionId) => void;
  onClose: () => void;
  onSignOut: () => void;
}

/**
 * Slide-over "everything else" hub — a wide icon-grid menu banded into the
 * same groups as the web sidebar, rather than a narrow flat list of text
 * rows. Overview already lives one tap away in the bottom tab bar and now
 * also behind the header's home icon, so it's left out of the grid below —
 * nothing here duplicates it.
 */
export function NavDrawer({
  visible,
  activeSection,
  patientName,
  patientNumber,
  initials,
  onSelect,
  onClose,
  onSignOut,
}: NavDrawerProps) {
  const groups = SECTION_GROUP_ORDER.filter((group) => group !== "top" && SECTIONS.some((s) => s.group === group));

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View
          style={{
            width: "84%",
            maxWidth: 420,
            height: "100%",
            backgroundColor: colors.card,
            shadowColor: "#000",
            shadowOffset: { width: 2, height: 0 },
            shadowOpacity: 0.15,
            shadowRadius: 20,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 58,
              paddingHorizontal: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go to Overview"
                onPress={() => onSelect("overview")}
                hitSlop={8}
              >
                <Ionicons name="home-outline" size={20} color={colors.ink} />
              </Pressable>
              <View style={{ width: 1, height: 18, backgroundColor: colors.border }} />
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.navy }}>Menu</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>

          {/* Banded and scrollable. The list grew from twelve entries to
              seventeen when the five missing sections were added, which is
              past what fits on a small phone and well past what anyone scans
              as one flat column — same reasoning, and the same band names, as
              the web sidebar. */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: spacing.screen, gap: 18 }}
            showsVerticalScrollIndicator={false}
          >
            {groups.map((group, i) => {
              const items = SECTIONS.filter((s) => s.group === group);
              return (
                <View key={group} style={{ gap: 12 }}>
                  {i > 0 ? <SectionDivider /> : null}
                  <SectionLabel>{group}</SectionLabel>
                  <QuickActionGrid>
                    {items.map((section) => (
                      <QuickActionButton
                        key={section.id}
                        icon={section.icon}
                        label={section.label}
                        active={section.id === activeSection}
                        onPress={() => onSelect(section.id)}
                      />
                    ))}
                  </QuickActionGrid>
                </View>
              );
            })}
          </ScrollView>

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 16, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: colors.brandTint,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.brandPressed }}>{initials}</Text>
              </View>
              <View>
                <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>{patientName}</Text>
                <Text style={{ fontSize: 11, color: colors.faint }}>
                  Patient{patientNumber ? ` · ${patientNumber}` : ""}
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 10.5, color: colors.faint }}>
              Version {Constants.expoConfig?.version ?? "—"}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onSignOut}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 6,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.ink} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Sign out</Text>
            </Pressable>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} />
      </View>
    </Modal>
  );
}
