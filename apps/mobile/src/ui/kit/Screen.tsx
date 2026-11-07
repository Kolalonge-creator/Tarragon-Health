import type { ReactElement, ReactNode, RefObject } from "react";
import { ScrollView, View, type RefreshControlProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space, useTheme } from "../design";

interface ScreenProps {
  children: ReactNode;
  /** Scrolls the content. Default true; pass false for a fixed layout. */
  scroll?: boolean;
  /** Safe-area edges to respect. The app shell already pads the top, so screens inside it usually pass none. */
  edges?: ("top" | "bottom" | "left" | "right")[];
  /** Pull to refresh, for screens that load data. */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Lets a screen scroll itself, for example a "Log a reading" button that jumps to the form further down. */
  scrollRef?: RefObject<ScrollView | null>;
}

/** The canvas every kit screen sits on: theme background, standard gutter, keyboard-friendly scrolling. */
export function Screen({ children, scroll = true, edges = ["left", "right"], refreshControl, scrollRef }: ScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.canvas }}>
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.xl, gap: space.lg }}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: space.xl, gap: space.lg }}>{children}</View>
      )}
    </SafeAreaView>
  );
}
