import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SECTIONS, SECTION_GROUP_ORDER, type SectionId } from "@/lib/sections";
import { colors } from "./theme";

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

/** Slide-over section drawer — the Claude Design prototype's "Nav Drawer". */
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
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View
          style={{
            width: 280,
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
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.navy }}>TarragonHealth</Text>
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
            contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {SECTION_GROUP_ORDER.map((group) => {
              const items = SECTIONS.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <View key={group} style={{ marginBottom: 8 }}>
                  {group !== "top" && (
                    <Text
                      style={{
                        fontSize: 10.5,
                        fontWeight: "700",
                        letterSpacing: 0.6,
                        textTransform: "uppercase",
                        color: colors.faint,
                        paddingHorizontal: 10,
                        paddingTop: 8,
                        paddingBottom: 4,
                      }}
                    >
                      {group}
                    </Text>
                  )}
                  <View style={{ gap: 2 }}>
                    {items.map((section) => {
                      const active = section.id === activeSection;
                      return (
                        <Pressable
                          key={section.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => onSelect(section.id)}
                          style={({ pressed }) => ({
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                            padding: 10,
                            borderRadius: 8,
                            backgroundColor: active
                              ? "#E7EEE7"
                              : pressed
                                ? "#F5F5F4"
                                : "transparent",
                          })}
                        >
                          <Ionicons
                            name={section.icon}
                            size={17}
                            color={active ? colors.brandPressed : colors.muted}
                          />
                          <Text
                            style={{
                              fontSize: 13.5,
                              fontWeight: "500",
                              color: active ? colors.brandPressed : colors.ink,
                            }}
                          >
                            {section.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 16, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: "#E7EEE7",
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
            <Pressable
              accessibilityRole="button"
              onPress={onSignOut}
              style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? "#F5F5F4" : colors.card,
                borderRadius: 8,
                padding: 9,
                alignItems: "center",
              })}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "500", color: colors.ink }}>Sign out</Text>
            </Pressable>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} />
      </View>
    </Modal>
  );
}
