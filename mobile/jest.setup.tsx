/* Jest setup: mocks for native modules the app touches. */

jest.mock("@react-native-community/netinfo", () =>
  require("@react-native-community/netinfo/jest/netinfo-mock.js"),
);

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: "cancel" })),
  maybeCompleteAuthSession: jest.fn(),
}));

jest.mock("expo-linking", () => ({
  createURL: jest.fn((path: string) => `ams://${path}`),
}));

jest.mock("expo-device", () => ({ isDevice: true }));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
  useLastNotificationResponse: jest.fn(() => null),
  AndroidImportance: { DEFAULT: 3 },
}));

jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  const DateTimePicker = (props: Record<string, unknown>) => <View {...props} />;
  return { __esModule: true, default: DateTimePicker, DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() } };
});

jest.mock("@react-native-community/slider", () => {
  const { View } = require("react-native");
  const Slider = (props: Record<string, unknown>) => <View accessibilityRole="adjustable" {...props} />;
  return { __esModule: true, default: Slider };
});

// Expo Router is exercised through real navigation only in the app; screen tests use these.
jest.mock("expo-router", () => require("./src/test/expoRouterMock"));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
