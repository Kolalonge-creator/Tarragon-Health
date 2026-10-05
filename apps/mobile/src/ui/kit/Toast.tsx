import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { elevation, radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { haptic } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "./PressableScale";

export type ToastTone = "info" | "success" | "warn" | "error";

interface ToastOptions {
  message: string;
  tone?: ToastTone;
}

interface ToastApi {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

const AUTO_HIDE_MS: Record<ToastTone, number> = { info: 3500, success: 3000, warn: 6000, error: 8000 };
const ICON: Record<ToastTone, IconName> = { info: "info", success: "done", warn: "alert", error: "alert" };

/**
 * One toast at a time, announced to screen readers, dismissed by tap or after a
 * delay (longer for warnings and errors so they can be read). Success and
 * warning give a haptic. Wrap the app once, call useToast().show(...) anywhere.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors, scheme, reducedMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const locale = asLocale(useUiLanguage());
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    ({ message, tone = "info" }: ToastOptions) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, tone, id: Date.now() });
      // iOS VoiceOver ignores accessibilityLiveRegion, so announce explicitly.
      AccessibilityInfo.announceForAccessibility(message);
      if (tone === "success") haptic.success();
      else if (tone === "warn") haptic.warning();
      else if (tone === "error") haptic.error();
      timer.current = setTimeout(() => setToast(null), AUTO_HIDE_MS[tone]);
    },
    []
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const api = useMemo(() => ({ show }), [show]);
  const tone = toast?.tone ?? "info";
  const fill = tone === "warn" ? colors.warnBg : tone === "error" ? colors.dangerBg : colors.surface;
  const text = tone === "warn" ? "warnText" : tone === "error" ? "dangerText" : "text";

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={reducedMotion ? undefined : FadeInDown.duration(180)}
          exiting={reducedMotion ? undefined : FadeOutUp.duration(160)}
          pointerEvents="box-none"
          style={{ position: "absolute", top: insets.top + space.sm, left: space.lg, right: space.lg }}
        >
          <PressableScale
            onPress={dismiss}
            withHaptic={false}
            scaleTo={0.99}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            accessibilityLabel={toast.message}
            accessibilityHint={t("kit.tap_to_dismiss", locale)}
            style={[{ backgroundColor: fill, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: space.md, paddingHorizontal: space.lg }, elevation(scheme, 2)]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Icon name={ICON[tone]} size={18} tone={text} />
              <AppText variant="bodyStrong" tone={text} style={{ flex: 1 }}>
                {toast.message}
              </AppText>
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
