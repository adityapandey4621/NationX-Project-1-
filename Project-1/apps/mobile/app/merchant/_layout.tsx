import { Redirect, Stack } from "expo-router";
import { Loading } from "../../src/components/states";
import { useSession } from "../../src/state/session";
import { useColors } from "../../src/theme";

/**
 * Merchant screens need a signed-in account. This is a convenience redirect; every merchant endpoint
 * independently requires membership of the shop (server + row-level security), so skipping it gains nothing.
 */
export default function MerchantLayout() {
  const c = useColors();
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signedOut") return <Redirect href="/sign-in" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="shop/[shopId]/index" options={{ title: "Shop details" }} />
      <Stack.Screen name="shop/[shopId]/products/index" options={{ title: "Items" }} />
      <Stack.Screen name="shop/[shopId]/products/[productId]" options={{ title: "Item" }} />
    </Stack>
  );
}