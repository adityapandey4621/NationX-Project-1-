import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { MODEL_LABELS } from "../lib/format";
import type { ShopResult } from "../lib/types";
import { radius, space, useColors } from "../theme";
import { Card, Text } from "./ui";

export function ShopImage({ uri, size = 56, label }: { uri: string | null; size?: number; label: string }) {
  const c = useColors();
  return uri ? (
    <Image source={{ uri }} alt={label} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: c.skeleton }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri} transition={120} />
  ) : (
    <View accessibilityElementsHidden style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" }}>
      <Text variant="large" style={{ color: c.primary }}>{label.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

/** One published shop in a list. Tapping opens the in-app storefront (also reachable by deep link). */
export function ShopCard({ shop }: { shop: ShopResult }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push({ pathname: "/shop/[slug]", params: { slug: shop.slug } })} label={`${shop.shop_name}, ${shop.category_name}, ${shop.locality_name}`}>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <ShopImage uri={shop.logo_url} label={shop.shop_name} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="large" numberOfLines={1}>{shop.shop_name}</Text>
          <Text variant="small" muted numberOfLines={1}>{shop.category_name} · {shop.locality_name}</Text>
          {shop.headline ? <Text variant="small" numberOfLines={2}>{shop.headline}</Text> : null}
          <Text variant="small" muted numberOfLines={1}>{shop.operating_models.map((m) => MODEL_LABELS[m] ?? m).join(" · ")}</Text>
        </View>
      </View>
    </Card>
  );
}