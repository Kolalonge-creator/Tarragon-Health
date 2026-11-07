import { useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useT, useUiLanguage } from "@/lib/ui-language";
import { SECTIONS, SECTION_GROUP_ORDER, type SectionId } from "@/lib/sections";
import { searchSections } from "@/lib/section-search";
import { SECTION_ICONS } from "./section-icons";
import { radii, space, textStyles, useTheme } from "./design";
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
  /** A small count on a menu tile (S29e: people who need a supporter's attention, the backup for the push). Zero or missing shows nothing. */
  badges?: Partial<Record<SectionId, number>>;
}

/**
 * Slide-over "everything else" hub: an icon-grid menu in the same groups and order
 * as the web side menu (My health, Healthcare, My support, Resources, Account), each
 * a row you can open, with the quieter sections behind "More in <group>".
 * Overview already lives one tap away in the bottom tab bar and
 * behind the header's home icon, so it is left out of the grid, nothing here
 * duplicates it. The section names and band names still come from lib/sections.ts
 * and the older translator (useT); only the drawer's own words are new keys.
 */
export function NavDrawer({ visible, activeSection, patientName, patientNumber, initials, onSelect, onClose, onSignOut, hiddenSections = [], badges = {} }: NavDrawerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const locale = asLocale(useUiLanguage());
  const tr = useT();
  const label = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);

  // The same groups and order as the web side menu (lib/sections.ts). The unlabelled top group stays open; the rest collapse to a
  // row you can open. Only the group holding the current section opens by default; tapping a row overrides that for this session.
  // Inside a group, the `more` sections sit behind "More in this group", which opens on its own when the current section is one.
  const shown = SECTIONS.filter((s) => !hiddenSections.includes(s.id));
  const topItems = shown.filter((s) => s.group === "top" && s.id !== "overview");
  const groups = SECTION_GROUP_ORDER.filter((group) => group !== "top" && shown.some((s) => s.group === group));
  const activeDef = SECTIONS.find((s) => s.id === activeSection);
  const activeGroup = activeDef?.group;
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({});
  const isMoreOpen = (group: string) => moreOpen[group] ?? (activeGroup === group && activeDef?.more === true);
  // What the person typed. Only sections this account can see are searched (hiddenSections is already applied to `shown`).
  const [query, setQuery] = useState("");
  const matches = searchSections(shown.map((s) => s.id), query, (l) => tr(l));
  const searching = query.trim().length > 0;
  const isOpen = (group: string) => manualOpen[group] ?? group === activeGroup;

  const grid = (items: typeof SECTIONS) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.lg }}>
      {items.map((section) => (
        <Tile
          key={section.id}
          section={section.id}
          label={tr(section.label)}
          active={section.id === activeSection}
          badge={badges[section.id] ?? 0}
          a11yBadge={(n) => label("drawer.badge_a11y", { label: tr(section.label), count: n })}
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

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, gap: space.xl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search, for example tablets or results"
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel="Search the app"
              returnKeyType="search"
              autoCorrect={false}
              style={{ ...textStyles.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, minHeight: 44 }}
            />
            {searching ? (
              <View style={{ gap: space.xs }}>
                {matches.length === 0 ? (
                  <AppText variant="body" tone="textMuted">Nothing matches that. Try another word, like a screen name or a health topic.</AppText>
                ) : (
                  matches.map((m) => (
                    <PressableScale
                      key={m.id}
                      onPress={() => {
                        setQuery("");
                        onSelect(m.id);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={m.label}
                      style={{ minHeight: 44, justifyContent: "center", paddingVertical: space.xs }}
                    >
                      <AppText variant="bodyStrong">{m.label}</AppText>
                      <AppText variant="caption" tone="textMuted">{m.group === "top" ? tr("Home") : tr(m.group)}</AppText>
                    </PressableScale>
                  ))
                )}
              </View>
            ) : null}
            {!searching ? (<>
            {topItems.length > 0 ? grid(topItems) : null}
            {groups.map((group) => {
              const items = shown.filter((s) => s.group === group);
              const mainItems = items.filter((s) => !s.more);
              const moreItems = items.filter((s) => s.more);
              const open = isOpen(group);
              const showMore = isMoreOpen(group);
              const name = tr(group);
              const Chevron = open ? ChevronDown : ChevronRight;
              const MoreChevron = showMore ? ChevronDown : ChevronRight;
              return (
                <View key={group} style={{ gap: space.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm }}>
                  {/* A group reads as a row you can open, not a faint heading (the web's 2026-11-06 visual pass). */}
                  <PressableScale
                    onPress={() => setManualOpen((m) => ({ ...m, [group]: !open }))}
                    withHaptic={false}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={label(open ? "drawer.expanded" : "drawer.collapsed", { group: name })}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}
                  >
                    <AppText variant="bodyStrong" tone={open ? "text" : "textMuted"}>
                      {name}
                    </AppText>
                    <Chevron size={16} color={colors.textSubtle} strokeWidth={2} />
                  </PressableScale>
                  {open ? grid(mainItems) : null}
                  {open && moreItems.length > 0 ? (
                    <>
                      <PressableScale
                        onPress={() => setMoreOpen((m) => ({ ...m, [group]: !showMore }))}
                        withHaptic={false}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: showMore }}
                        accessibilityLabel={label(showMore ? "drawer.expanded" : "drawer.collapsed", { group: tr(`More in ${group}`) })}
                        style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44 }}
                      >
                        <MoreChevron size={14} color={colors.textSubtle} strokeWidth={2} />
                        {/* One whole phrase per group, as on the web. */}
                        <AppText variant="label" tone="textMuted">
                          {tr(`More in ${group}`)}
                        </AppText>
                      </PressableScale>
                      {showMore ? grid(moreItems) : null}
                    </>
                  ) : null}
                </View>
              );
            })}
            </>) : null}
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

function Tile({ section, label, active, onPress, badge = 0, a11yBadge }: { section: SectionId; label: string; active: boolean; onPress: () => void; badge?: number; a11yBadge?: (n: number) => string }) {
  const { colors } = useTheme();
  const Glyph = SECTION_ICONS[section];
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 && a11yBadge ? a11yBadge(badge) : label}
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
        {badge > 0 ? (
          <View style={{ position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerText, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }} accessibilityElementsHidden importantForAccessibility="no">
            <AppText variant="caption" style={{ color: colors.dangerText }}>{badge > 9 ? "9+" : String(badge)}</AppText>
          </View>
        ) : null}
      </View>
      <AppText variant={active ? "label" : "caption"} tone={active ? "brandText" : "text"} align="center" numberOfLines={3}>
        {label}
      </AppText>
    </PressableScale>
  );
}
