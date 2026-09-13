import { Platform, Pressable, Text, View } from "react-native";
import { useT } from "@/lib/ui-language";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { PRIMARY_SECTIONS, type SectionId } from "@/lib/sections";
import { colors } from "./theme";

interface BottomTabBarProps {
  activeSection: SectionId;
  onSelect: (id: SectionId) => void;
  onMore: () => void;
}

/**
 * The app's primary navigation.
 *
 * Every destination used to sit behind the hamburger drawer, which is a web
 * pattern rather than a native one: on a phone the drawer costs a tap and a
 * hunt through a twelve-item list before you can do the thing you opened the
 * app for. The everyday sections now sit permanently in thumb reach, and More
 * opens the same drawer for everything else, so nothing is less reachable
 * than before.
 *
 * Tabs come from PRIMARY_SECTIONS, so this file never decides what is
 * important — lib/sections.ts does, in one place shared with the drawer.
 */
/** Floor for the iOS home indicator / Android gesture-nav clearance, used
 * when the device reports no real inset (e.g. older Android with a hardware
 * back button and no gesture bar). Real devices use useSafeAreaInsets()
 * below instead of a guessed per-platform constant. */
const MIN_BOTTOM_INSET = Platform.OS === "ios" ? 22 : 8;

export function BottomTabBar({ activeSection, onSelect, onMore }: BottomTabBarProps) {
  const tr = useT();
  const moreActive = !PRIMARY_SECTIONS.some((s) => s.id === activeSection);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.card,
        paddingBottom: Math.max(insets.bottom, MIN_BOTTOM_INSET),
        paddingTop: 6,
      }}
    >
      {PRIMARY_SECTIONS.map((section) => {
        const active = section.id === activeSection;
        return (
          <Tab
            key={section.id}
            icon={section.icon}
            label={tr(section.shortLabel ?? section.label)}
            active={active}
            onPress={() => onSelect(section.id)}
          />
        );
      })}
      <Tab icon="menu-outline" label={tr("More")} active={moreActive} onPress={onMore} />
    </View>
  );
}

function Tab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        paddingVertical: 4,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={21} color={active ? colors.brand : colors.muted} />
      <Text
        numberOfLines={1}
        style={{
          fontSize: 10.5,
          fontWeight: active ? "700" : "500",
          color: active ? colors.brandPressed : colors.muted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
