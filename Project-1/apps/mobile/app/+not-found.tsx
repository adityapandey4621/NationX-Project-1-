import { Link, Stack } from "expo-router";
import { View } from "react-native";
import { Text } from "../src/components/ui";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: "center" }}>
        <Text variant="title">That page doesn&apos;t exist</Text>
        <Link href="/" style={{ fontSize: 16 }}>Go to the home screen</Link>
      </View>
    </>
  );
}