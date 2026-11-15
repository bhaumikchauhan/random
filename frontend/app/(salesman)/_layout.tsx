import { Tabs, useRouter } from "expo-router";
import { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useAuth } from "@/src/auth";
import { useLocationPinger } from "@/src/locationTracker";
import { colors, spacing } from "@/src/theme";

export default function SalesmanLayout() {
  const { user, loading, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role !== "salesman") router.replace("/(admin)/dashboard");
  }, [user, loading]);

  useLocationPinger(user?.role === "salesman" ? token : null);

  if (!user || user.role !== "salesman") return null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.onSurfaceTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: Platform.OS === "ios" ? 84 : 64,
          paddingTop: spacing.xs,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="day" options={{
        title: "My Day",
        tabBarIcon: ({ color, size }) => <Ionicons name="sunny" size={size} color={color} />,
      }} />
      <Tabs.Screen name="customers" options={{
        title: "Customers",
        tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
      }} />
      <Tabs.Screen name="visits" options={{
        title: "Bills",
        tabBarIcon: ({ color, size }) => <Ionicons name="receipt" size={size} color={color} />,
      }} />
      <Tabs.Screen name="map" options={{
        title: "Map",
        tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
      }} />
      <Tabs.Screen name="more" options={{
        title: "More",
        tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} />,
      }} />
    </Tabs>
  );
}
