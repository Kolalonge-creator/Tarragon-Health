import { Component, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import App from "../App";
import { reportBoundaryError } from "@/lib/crash-reporting";
import { colors, spacing } from "@/ui/theme";

/**
 * S88a: top-level error boundary. A render crash used to leave a white screen. Now the patient sees a calm screen with
 * a way back in, and the scrubbed error goes to the crash reporter (dormant unless a DSN is set). The component stack is
 * deliberately not forwarded.
 */
class CrashBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    reportBoundaryError(error);
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.screen, backgroundColor: colors.brand }}>
        <Text style={{ color: "#FFFFFF", fontSize: 18, textAlign: "center", marginBottom: spacing.card }}>
          Something went wrong on our side. Please try again.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })} style={{ padding: spacing.card }}>
          <Text style={{ color: "#FFFFFF", fontSize: 16, textDecorationLine: "underline" }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

export default function Root() {
  return (
    <CrashBoundary>
      <App />
    </CrashBoundary>
  );
}
