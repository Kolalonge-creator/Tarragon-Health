import { useEffect } from "react";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { duration, radii, useTheme } from "../design";

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** A placeholder block that pulses while content loads. Static under reduced motion. */
export function Skeleton({ width = "100%", height = 16, radius = radii.sm, style }: SkeletonProps) {
  const { colors, reducedMotion } = useTheme();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: duration.slow * 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: duration.slow * 2, easing: Easing.inOut(Easing.ease) })
      ),
      -1
    );
  }, [reducedMotion, opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceMuted }, animated, style]} />;
}

/** Wraps skeletons so a screen reader hears one "Loading" instead of many empty blocks. */
export function SkeletonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} importantForAccessibility="yes">
      {children}
    </View>
  );
}
