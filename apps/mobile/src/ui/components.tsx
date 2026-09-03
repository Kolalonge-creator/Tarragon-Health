import { Children, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, inkAlpha, radius, spacing, typeScale } from "./theme";

interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function PrimaryButton({ title, onPress, disabled, loading }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: disabled ? colors.faint : pressed ? colors.brandPressed : colors.brand,
        borderRadius: radius.control,
        paddingVertical: 14,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled, loading }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.pressed : colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.control,
        paddingVertical: 13,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Compact pill used for inline choices (e.g. glucose context). */
export function ChoiceChip({ title, onPress, disabled }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.brandPressed : colors.brand,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: 24, fontWeight: "700", color: colors.ink }}>{children}</Text>
  );
}

export function MutedText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.muted, fontSize: typeScale.body, lineHeight: 20 }}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.danger, fontSize: typeScale.body }}>{children}</Text>;
}

const BADGE_TONES = {
  brand: { bg: colors.brandTint, text: colors.brandPressed },
  neutral: { bg: inkAlpha(0.08), text: colors.muted },
} as const;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  const c = BADGE_TONES[tone];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{children}</Text>
    </View>
  );
}

/** Full-width hairline rule that separates two labelled sections stacked in
 * the same scroll view — the rule between "Keeping you safe" and "Planning
 * your future" in the reference design. Only meaningful between two
 * SectionLabel blocks; don't sprinkle it between unrelated cards. */
export function SectionDivider() {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

/** Bold, uppercase, tracked-out label that introduces a block of content —
 * "A VIEW OF YOUR VEHICLE", "HELP & CONTACT" in the reference design. Reads
 * as a heading, not a muted caption, so keep the copy short. */
export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Text
      style={[
        {
          fontSize: 12.5,
          fontWeight: "800",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: colors.ink,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * One flat, recessed card holding several rows separated by hairline
 * dividers — "A VIEW OF YOUR VEHICLE" 's gallery/equipment/guide list. Each
 * child supplies its own row (usually GroupedListRow); this only handles the
 * shared background, corner radius, and the divider between rows.
 */
export function GroupedList({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
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
        backgroundColor: pressed ? inkAlpha(0.04) : "transparent",
      })}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "600", color: disabled ? colors.faint : colors.ink }}>
          {title}
        </Text>
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
      <Text
        numberOfLines={2}
        style={{
          fontSize: 11,
          fontWeight: active ? "700" : "500",
          color: active ? colors.brandPressed : colors.ink,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
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
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{title}</Text>
      </View>
      <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 18 }}>{subtitle}</Text>
      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand, alignSelf: "flex-end", marginTop: 2 }}>
        {ctaLabel.toUpperCase()}
      </Text>
    </Pressable>
  );
}
