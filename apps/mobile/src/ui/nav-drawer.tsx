import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useT, useUiLanguage } from "@/lib/ui-language";
import { SECTIONS, SECTION_GROUP_ORDER, type SectionId } from "@/lib/sections";
import { SECTION_ICONS } from "./section-icons";
import { radii, space, useTheme } from "./design";
import { AppText, Icon, PressableScale } from "./kit";

interface NavDrawerProps {
  visible: boolean;
  activeSection: SectionId;
  patientName: string;
  patientNumber: string | null;
  initials: string;
  onSelect: (id: SectionId) => void;
  onClose: () => void;
  onSignOut: () => void;
  /** Sections to leave out of the menu for this account (for example Community while it is not open). */
  hiddenSections?: readonly SectionId[];
}

/**
 * Slide-over "everything else" hub: an icon-grid menu banded into the same groups
 * as the web sidebar. Overview already lives one tap away in the bottom tab bar and
 * behind the header's home icon, so it is left out of the grid, nothing here
 * duplicates it. The section names and band names still come from lib/sections.ts
 * and the older translator (useT); only the drawer's own words are new keys.
 */
export function NavDrawer({ visible, activeSection, patientName, patientNumber, initials, onSelect, onClose, onSignOut, hiddenSections = [] }: NavDrawerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const locale = asLocale(useUiLanguage());
  const tr = useT();
  const label = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);

  // The everyday jobs stay open; the rest collapse to their headings. Only the band
  // holding the current section opens by default; tapping a heading overrides that for
  // this session. This mirrors the web sidebar's progressive disclosure.
  const shown = SECTIONS.filter((s) => !hiddenSections.includes(s.id));
  const everydayItems = shown.filter((s) => s.group === "top" && s.id !== "overview");
  const groups = SECTION_GROUP_ORDER.filter((group) => group !== "top" && shown.some((s) => s.group === group));
  const activeGroup = SECTIONS.find((s) => s.id === activeSection)?.group;
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const isOpen = (group: string) => manualOpen[group] ?? group === activeGroup;

  const grid = (items: typeof SECTIONS) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.lg }}>
      {items.map((section) => (
        <Tile
          key={section.id}
          section={section.id}
          label={tr(section.label)}
          active={section.id === activeSection}
          onPress={() => onSelect(section.id)}
        />
      ))}
    </View>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: "row" }} accessibilityViewIsModal>
        <View style={{ width: "84%", maxWidth: 420, height: "100%", backgroundColor: colors.surface }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: insets.top + space.sm,
              paddingHorizontal: space.lg,
              paddingBottom: space.sm,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <PressableScale onPress={() => onSelect("overview")} accessibilityRole="button" accessibilityLabel={label("drawer.home_a11y")} style={{ width: 44, alignItems: "center", justifyContent: "center" }}>
                <Icon name="home" size={20} />
              </PressableScale>
              <AppText variant="title" heading>
                {label("drawer.menu")}
              </AppText>
            </View>
            <PressableScale onPress={onClose} withHaptic={false} accessibilityRole="button" accessibilityLabel={label("drawer.close_a11y")} style={{ width: 44, alignItems: "center", justifyContent: "center" }}>
              <Icon name="close" size={22} tone="textMuted" />
            </PressableScale>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, gap: space.xl }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: space.md }}>
              <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
                {tr("Everyday")}
              </AppText>
              {grid(everydayItems)}
            </View>
            {groups.map((group) => {
              const items = shown.filter((s) => s.group === group);
              const open = isOpen(group);
              const name = tr(group);
              const Chevron = open ? ChevronDown : ChevronRight;
              return (
                <View key={group} style={{ gap: space.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md }}>
                  <PressableScale
                    onPress={() => setManualOpen((m) => ({ ...m, [group]: !open }))}
                    withHaptic={false}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={label(open ? "drawer.expanded" : "drawer.collapsed", { group: name })}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {name}
                    </AppText>
                    <Chevron size={16} color={colors.textSubtle} strokeWidth={2} />
                  </PressableScale>
                  {open ? grid(items) : null}
                </View>
              );
            })}
          </ScrollView>

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
                <AppText variant="label" tone="brandText" maxFontSizeMultiplier={1.2}>
                  {initials}
                </AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{patientName}</AppText>
                <AppText variant="caption" tone="textSubtle">
                  {label("drawer.patient")}
                  {patientNumber ? ` · ${patientNumber}` : ""}
                </AppText>
              </View>
            </View>
            <AppText variant="caption" tone="textSubtle">
              {label("drawer.version", { version: Constants.expoConfig?.version ?? "-" })}
            </AppText>
            <PressableScale onPress={onSignOut} accessibilityRole="button" accessibilityLabel={label("drawer.sign_out")} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Icon name="signOut" size={18} />
              <AppText variant="bodyStrong">{label("drawer.sign_out")}</AppText>
            </PressableScale>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={label("drawer.close_a11y")} onPress={onClose} style={{ flex: 1, backgroundColor: colors.scrim }} />
      </View>
    </Modal>
  );
}

function Tile({ section, label, active, onPress }: { section: SectionId; label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const Glyph = SECTION_ICONS[section];
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{ width: "33.33%", alignItems: "center", gap: space.xs }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radii.md,
          backgroundColor: active ? colors.brandTint : colors.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Glyph size={22} color={active ? colors.brandText : colors.text} strokeWidth={2} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <AppText variant={active ? "label" : "caption"} tone={active ? "brandText" : "text"} align="center" numberOfLines={3}>
        {label}
      </AppText>
    </PressableScale>
  );
}
