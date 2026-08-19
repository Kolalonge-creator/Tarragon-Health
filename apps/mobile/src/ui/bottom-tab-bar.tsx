import { Platform, Pressable, Text, View } from "react-native";
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
/** Room for the iOS home indicator. Hardcoded per platform rather than read
 * from safe-area insets, because react-native-safe-area-context is not a
 * dependency of this app and adding one would force a native rebuild — the
 * same convention the top bar and drawer already follow. */
const BOTTOM_INSET = Platform.OS === "ios" ? 22 : 8;

export function BottomTabBar({ activeSection, onSelect, onMore }: BottomTabBarProps) {
  const moreActive = !PRIMARY_SECTIONS.some((s) => s.id === activeSection);

  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.card,
        paddingBottom: BOTTOM_INSET,
        paddingTop: 6,
      }}
    >
      {PRIMARY_SECTIONS.map((section) => {
        const active = section.id === activeSection;
        return (
          <Tab
            key={section.id}
            icon={section.icon}
            label={section.shortLabel ?? section.label}
            active={active}
            onPress={() => onSelect(section.id)}
          />
        );
      })}
      <Tab icon="menu-outline" label="More" active={moreActive} onPress={onMore} />
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
