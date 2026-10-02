import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space, useTheme } from "../design";

interface ScreenProps {
  children: ReactNode;
  /** Scrolls the content. Default true; pass false for a fixed layout. */
  scroll?: boolean;
  /** Safe-area edges to respect. The app shell already pads the top, so screens inside it usually pass none. */
  edges?: ("top" | "bottom" | "left" | "right")[];
}

/** The canvas every kit screen sits on: theme background, standard gutter, keyboard-friendly scrolling. */
export function Screen({ children, scroll = true, edges = ["left", "right"] }: ScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.canvas }}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.xl, gap: space.lg }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: space.xl, gap: space.lg }}>{children}</View>
      )}
    </SafeAreaView>
  );
}
