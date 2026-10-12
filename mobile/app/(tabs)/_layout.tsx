import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/js-tabs";
import { useTheme } from "../../src/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function icon(name: IconName, focusedName: IconName) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={focused ? focusedName : name} color={color} size={size} />
  );
}

export default function TabsLayout() {
  const p = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p.textMuted,
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Today", tabBarIcon: icon("today-outline", "today"), tabBarAccessibilityLabel: "Today" }}
      />
      <Tabs.Screen
        name="trends"
        options={{ title: "Trends", tabBarIcon: icon("analytics-outline", "analytics"), tabBarAccessibilityLabel: "Trends" }}
      />
      <Tabs.Screen
        name="devices"
        options={{ title: "Devices", tabBarIcon: icon("watch-outline", "watch"), tabBarAccessibilityLabel: "Devices" }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: icon("person-circle-outline", "person-circle"),
          tabBarAccessibilityLabel: "Profile",
        }}
      />
    </Tabs>
  );
}
