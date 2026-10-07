import * as Haptics from "expo-haptics";

/**
 * Tactile feedback for the kit. Light for a press, success for a saved reading
 * or a dose taken, warning for something that needs a second look. Never throws:
 * a device without a haptic engine, or a simulator, simply feels nothing.
 */
export const haptic = {
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  error: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
};
