import { useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey, type MessageParams } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText, Icon, PressableScale } from "@/ui/kit";

/** The Community words, from packages/i18n (community.*). English only, like the rest of the app. */
export type Copy = (key: MessageKey, params?: MessageParams) => string;

export function useCopy(): Copy {
  const locale = asLocale(useUiLanguage());
  return useCallback((key, params) => t(key, locale, params), [locale]);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/** A member's picture is a preset word chosen by the database, drawn as an initial in a circle. Hidden from screen readers: the made-up name identifies the member. */
export function Avatar({ code }: { code: string | null }) {
  const { colors } = useTheme();
  const initial = (code ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}
    >
      <AppText variant="bodyStrong" tone="brandText">
        {initial}
      </AppText>
    </View>
  );
}

/** A tick box the member sets themselves. A real checkbox for screen readers, at least 44 points to hit. */
export function CheckRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={disabled ? undefined : () => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: !!disabled }}
      scaleTo={0.99}
      style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: space.md, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: radii.sm,
          borderWidth: 2,
          borderColor: checked ? colors.brand : colors.textSubtle,
          backgroundColor: checked ? colors.brand : colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Icon name="done" size={16} tone="textOnBrand" /> : null}
      </View>
      <AppText style={{ flex: 1 }}>{label}</AppText>
    </PressableScale>
  );
}

/** A quiet text-style action (Support, Reply, Report...). At least 44 points to hit. */
export function TextAction({
  label,
  onPress,
  accessibilityLabel,
  selected,
  expanded,
  disabled,
  tone = "brandText",
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  tone?: "brandText" | "textMuted" | "dangerText";
}) {
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, expanded, disabled: !!disabled }}
      scaleTo={0.97}
      style={{ minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: space.sm, opacity: disabled ? 0.5 : 1 }}
    >
      <AppText variant="label" tone={tone}>
        {label}
      </AppText>
    </PressableScale>
  );
}

/** A polite status line that screen readers announce when its text changes. Renders nothing while empty. */
export function Status({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <AppText variant="caption" tone="textMuted" accessibilityLiveRegion="polite" accessibilityRole="alert">
      {text}
    </AppText>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.lg, padding: space.lg }}>
      <AppText variant="bodyStrong" heading>
        {title}
      </AppText>
      {children}
    </View>
  );
}
