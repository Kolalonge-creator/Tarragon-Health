import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { MIN_TARGET, PRESS_SCALE, spring, useTheme } from "../design";
import { haptic } from "./haptics";
import { splitLayoutStyle } from "./layout";

const AnimatedView = Animated.View;

interface PressableScaleProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** Light tap feedback on press in. Off for rows inside a scrolling list if it feels busy. */
  withHaptic?: boolean;
  scaleTo?: number;
}

/**
 * A pressable that sinks slightly under the finger and gives a light haptic on a completed press.
 * Skips the animation when the patient asked for reduced motion. Always at least
 * 44 points to hit (hitSlop pads smaller content).
 */
export function PressableScale({ style, withHaptic = true, scaleTo = PRESS_SCALE, onPress, onPressIn, onPressOut, children, ...rest }: PressableScaleProps) {
  const { outer, inner } = splitLayoutStyle(style);
  const { reducedMotion } = useTheme();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      style={outer}
      // Haptic on a completed press, never on touch-down: a finger that lands on a row
      // to start a scroll must not buzz.
      onPress={
        onPress
          ? (e) => {
              if (withHaptic) haptic.light();
              onPress(e);
            }
          : undefined
      }
      onPressIn={(e) => {
        if (!reducedMotion) scale.value = withSpring(scaleTo, spring.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reducedMotion) scale.value = withSpring(1, spring.press);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <AnimatedView style={[{ minHeight: MIN_TARGET }, animated, inner]}>{children as React.ReactNode}</AnimatedView>
    </Pressable>
  );
}
