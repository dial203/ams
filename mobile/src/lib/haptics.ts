import * as Haptics from "expo-haptics";

/** Fire-and-forget haptics; never throws (unsupported devices, tests). */
function run(effect: () => Promise<void> | void): void {
  Promise.resolve()
    .then(effect)
    .catch(() => undefined);
}

export const haptics = {
  selection: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
