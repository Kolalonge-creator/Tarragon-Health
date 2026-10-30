import { useEffect, useRef, useState } from "react";
import { AppState, Image, StyleSheet, View } from "react-native";
import { coverVisible, loadCoverEnabled } from "@/lib/privacy-cover";
import { colors } from "@/ui/theme";
import logoMarkWhite from "../../assets/logo-mark-white.png";

/**
 * Drawn above the whole app whenever it is not the foreground app, for people who have App lock or discreet mode on (see
 * lib/privacy-cover.ts for the rule and for what this cannot do on Android). Shows the brand mark and nothing else: no name,
 * no text, no part of the record. Hidden from screen readers because it is only ever visible while the app is not in use.
 */
export function PrivacyCover() {
  const [appState, setAppState] = useState<string>(AppState.currentState);
  const [enabled, setEnabled] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      void loadCoverEnabled()
        .then((on) => {
          if (alive.current) setEnabled(on);
        })
        .catch(() => {});
    };
    refresh();
    const sub = AppState.addEventListener("change", (next) => {
      setAppState(next);
      // Re-read when coming back, so a preference changed in Settings applies without a restart.
      if (next === "active") refresh();
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, []);

  if (!coverVisible(appState, enabled)) return null;
  return (
    <View
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", zIndex: 9999, elevation: 9999 }]}
    >
      <Image source={logoMarkWhite} style={{ width: 96, height: 133 }} resizeMode="contain" />
    </View>
  );
}
