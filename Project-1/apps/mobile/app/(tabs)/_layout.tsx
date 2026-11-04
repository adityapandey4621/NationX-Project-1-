import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { isMerchant } from "../../src/lib/roles";
import { useSession } from "../../src/state/session";
import { useColors } from "../../src/theme";

type IconName = keyof typeof Ionicons.glyphMap;

export default function TabsLayout() {
  const c = useColors();
  const { state } = useSession();
  const merchant = state.status === "signedIn" && isMerchant(state.me);
  const icon = (name: IconName) => function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border, height: 60, paddingBottom: 6 },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="search" options={{ title: "Search", tabBarIcon: icon("search-outline") }} />
      <Tabs.Screen name="help" options={{ title: "Find it", tabBarIcon: icon("help-buoy-outline") }} />
      <Tabs.Screen name="shop" options={{ title: merchant ? "My shop" : "Sell", tabBarIcon: icon("storefront-outline") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-outline") }} />
    </Tabs>
  );
}