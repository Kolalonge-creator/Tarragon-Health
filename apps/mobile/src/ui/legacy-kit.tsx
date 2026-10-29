/**
 * Theme-aware twins of the primitives in ./components.tsx, with the same names and props.
 * Moving an old screen onto the dark-aware look is: import from "@/ui/legacy-kit" instead of
 * "@/ui/components", and `const colors = useLegacyColors()` instead of importing `colors`.
 * Generated from components.tsx by swapping the static `colors` object for the scheme-aware
 * bridge; keep the two in step until the last screen has moved, then delete components.tsx.
 * Only switch a whole file at a time: mixing these with the static `colors` in one screen
 * gives dark text on a dark card.
 */
import { MIN_TARGET, useLegacyColors, useTheme } from "./design";
import { Children, type ReactNode } from "react";
import {
  Pressable,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing } from "./theme";
import { AppText } from "./kit/AppText";
import { Button } from "./kit/Button";
import { Card as KitCard } from "./kit/Card";

interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function PrimaryButton({ title, onPress, disabled, loading }: ButtonProps) {
  return <Button title={title} onPress={onPress} disabled={disabled} loading={loading} />;
}

export function SecondaryButton({ title, onPress, disabled, loading }: ButtonProps) {
  return <Button variant="secondary" title={title} onPress={onPress} disabled={disabled} loading={loading} />;
}

export function ChoiceChip({ title, onPress, disabled }: ButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: colors.brand,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
        // At least 44 points tall; a chip is a tap target like any button.
        minHeight: MIN_TARGET,
        justifyContent: "center",
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <AppText variant="label" tone="textOnBrand">
        {title}
      </AppText>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <KitCard style={style}>{children}</KitCard>;
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <AppText variant="headline" heading>
      {children}
    </AppText>
  );
}

export function MutedText({ children }: { children: ReactNode }) {
  return (
    <AppText variant="body" tone="textMuted">
      {children}
    </AppText>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <AppText variant="body" tone="dangerText">
      {children}
    </AppText>
  );
}

type BadgeTone = "brand" | "neutral";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  const { colors } = useTheme();
  const c = tone === "brand" ? { bg: colors.brandTint, text: "brandText" as const } : { bg: colors.surfaceMuted, text: "textMuted" as const };
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <AppText variant="caption" tone={c.text}>
        {children}
      </AppText>
    </View>
  );
}

/** Full-width hairline rule that separates two labelled sections stacked in
 * the same scroll view — the rule between "Keeping you safe" and "Planning
 * your future" in the reference design. Only meaningful between two
 * SectionLabel blocks; don't sprinkle it between unrelated cards. */
export function SectionDivider() {
  const colors = useLegacyColors();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

/** Bold, uppercase, tracked-out label that introduces a block of content —
 * "A VIEW OF YOUR VEHICLE", "HELP & CONTACT" in the reference design. Reads
 * as a heading, not a muted caption, so keep the copy short. */
export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <AppText variant="label" style={[{ textTransform: "uppercase", letterSpacing: 0.5 }, style]}>
      {children}
    </AppText>
  );
}

/**
 * One flat, recessed card holding several rows separated by hairline
 * dividers — "A VIEW OF YOUR VEHICLE" 's gallery/equipment/guide list. Each
 * child supplies its own row (usually GroupedListRow); this only handles the
 * shared background, corner radius, and the divider between rows.
 */
export function GroupedList({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useLegacyColors();
  const rows = Children.toArray(children);
  return (
    <View style={[{ backgroundColor: colors.groupBg, borderRadius: radius.card, overflow: "hidden" }, style]}>
      {/* Index keys are fine here: rows are arbitrary children with no
          natural id of their own, and callers own any list-item keying. */}
      {rows.map((row, i) => (
        <View key={i} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
          {row}
        </View>
      ))}
    </View>
  );
}

interface GroupedListRowProps {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** "chevron" for an in-app destination, "external" for a link that leaves
   * the app (browser/webview), "none" to omit, or any node (e.g. a Toggle)
   * for a row that isn't navigation at all. Defaults to "chevron". */
  trailing?: "chevron" | "external" | "none" | ReactNode;
  /** Optional leading node — a status dot, checkbox, or small icon badge —
   * for rows that need one, e.g. a dose's taken/pending indicator. */
  leading?: ReactNode;
  disabled?: boolean;
}

export function GroupedListRow({ title, subtitle, onPress, trailing = "chevron", leading, disabled }: GroupedListRowProps) {
  const colors = useLegacyColors();
  const trailingNode =
    trailing === "chevron" ? (
      <Ionicons name="chevron-forward" size={17} color={colors.faint} />
    ) : trailing === "external" ? (
      <Ionicons name="open-outline" size={16} color={colors.faint} />
    ) : trailing === "none" ? null : (
      trailing
    );

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={!onPress || disabled}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 13,
        paddingHorizontal: spacing.card,
        backgroundColor: pressed ? colors.pressed : "transparent",
      })}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" tone={disabled ? "textSubtle" : "text"}>
          {title}
        </AppText>
        {subtitle ? <MutedText>{subtitle}</MutedText> : null}
      </View>
      {trailingNode}
    </Pressable>
  );
}

/** Row of square icon tiles for one-tap shortcuts — the "Settings / Charge
 * here / Statistics / More…" row under each vehicle card. Wrap 4 to a row on
 * a standard phone width; QuickActionButton controls its own tile size so
 * the row still wraps sensibly on a narrower screen. */
export function QuickActionGrid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{children}</View>;
}

export function QuickActionButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Tints the tile brand-green — the section currently open, when this
   * grid is doubling as navigation (e.g. the nav drawer) rather than a set
   * of one-off shortcuts. Omit where there's no notion of "current". */
  active?: boolean;
}) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({ flexBasis: "22%", flexGrow: 1, alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radius.control,
          backgroundColor: active ? colors.brandTint : colors.groupBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={active ? colors.brandPressed : colors.ink} />
      </View>
      <AppText variant="caption" tone={active ? "brandText" : "text"} align="center" numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Support/assistant promo card — "BMW AI Assistant" / "Help Centre" in the
 * reference: an icon, a title, one line of subtitle, and a bold trailing
 * link-style call to action, with a faint decorative sparkle in the corner
 * so the block reads as inviting rather than a plain settings row. */
export function CalloutCard({
  icon,
  title,
  subtitle,
  ctaLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.groupBg,
        borderRadius: radius.card,
        padding: spacing.card,
        gap: 8,
        overflow: "hidden",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons
        name="sparkles-outline"
        size={54}
        color={colors.brand}
        style={{ position: "absolute", top: -12, right: -10, opacity: 0.12 }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={icon} size={18} color={colors.ink} />
        <AppText variant="bodyStrong">{title}</AppText>
      </View>
      <AppText variant="caption" tone="textMuted">
        {subtitle}
      </AppText>
      <AppText variant="label" tone="brandText" style={{ alignSelf: "flex-end", marginTop: 2 }}>
        {ctaLabel.toUpperCase()}
      </AppText>
    </Pressable>
  );
}
