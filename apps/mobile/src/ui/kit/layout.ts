import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

/** Style keys that decide how a control sits in its parent. They belong on the outermost touchable so its hit area matches what the patient sees. */
const OUTER_KEYS = [
  "alignSelf",
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "width",
  "minWidth",
  "maxWidth",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
  "position",
  "top",
  "bottom",
  "left",
  "right",
] as const;

/**
 * Splits a style into the part that positions the control (goes on the Pressable)
 * and the part that paints it (goes on the animated inner view). Without this, a
 * narrow button inside a full-width Pressable is tappable across the whole row.
 */
export function splitLayoutStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if ((OUTER_KEYS as readonly string[]).includes(key)) outer[key] = value;
    else inner[key] = value;
  }
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}
