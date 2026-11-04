import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OfflineBanner } from "../src/components/states";
import { Text } from "../src/components/ui";
import { configResult } from "../src/config";
import { SessionProvider } from "../src/state/session";
import { persister, queryClient, shouldPersist } from "../src/state/query-client";
import { useColors } from "../src/theme";

const DAY = 24 * 60 * 60 * 1000;

function ConfigProblem({ problems }: { problems: string[] }) {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 24, gap: 12 }} accessibilityRole="alert">
        <Text variant="title">NationX is not configured</Text>
        <Text muted>This build is missing settings it needs to reach the server. Copy .env.example to .env, fill in the values and restart.</Text>
        {problems.map((p) => (
          <Text key={p} variant="small">• {p}</Text>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  const c = useColors();
  if (!configResult.ok) return <ConfigProblem problems={configResult.problems} />;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: DAY,
        buster: "1",
        dehydrateOptions: { shouldDehydrateQuery: (q) => shouldPersist(q.queryKey, q.state.status) },
      }}
    >
      <SessionProvider>
        <StatusBar style="auto" />
        <SafeAreaView edges={["top"]} style={{ backgroundColor: c.bg }}>
          <OfflineBanner />
        </SafeAreaView>
        <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg }, headerShadowVisible: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="shop/[slug]" options={{ title: "" }} />
          <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
          <Stack.Screen name="sign-up" options={{ title: "Create account" }} />
          <Stack.Screen name="requests/index" options={{ title: "My requests" }} />
          <Stack.Screen name="requests/track" options={{ title: "Track a request" }} />
          <Stack.Screen name="merchant" options={{ headerShown: false }} />
        </Stack>
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}