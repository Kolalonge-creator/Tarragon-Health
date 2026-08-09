import { Pressable, Text, View } from "react-native";
import type { ActingFor } from "@/lib/acting";
import { colors, radius, spacing } from "./theme";

interface ActingForBannerProps {
  acting: ActingFor | null;
  onStop: () => void;
}

/**
 * Native equivalent of apps/web/src/app/(dashboard)/patient/acting-for-banner.tsx
 * — whose account is open, stated plainly and impossible to scroll past.
 * Rendered above every Home-tab section so it can never be mistaken for the
 * signed-in device owner's own record (a misattributed reading is not
 * cosmetic — the red-flag engines read it as that person's own account of
 * themselves).
 */
export function ActingForBanner({ acting, onStop }: ActingForBannerProps) {
  if (!acting) return null;
  const name = acting.fullName ?? "the person you support";

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginHorizontal: spacing.screen,
        marginTop: spacing.screen,
        borderWidth: 1,
        borderColor: "rgba(201,150,43,0.4)",
        backgroundColor: "rgba(201,150,43,0.1)",
        borderRadius: radius.card,
        padding: 12,
      }}
    >
      <View style={{ flex: 1, minWidth: 180 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>
          You are in {name}&apos;s account, not your own.
        </Text>
        <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
          Anything you record here is saved in their name with yours next to it.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onStop}
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: pressed ? "#F5F5F4" : colors.card,
          borderRadius: radius.control,
          paddingVertical: 8,
          paddingHorizontal: 12,
        })}
      >
        <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Back to my account</Text>
      </Pressable>
    </View>
  );
}
