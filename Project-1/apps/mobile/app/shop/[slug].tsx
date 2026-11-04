import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { RefreshControl, ScrollView, View } from "react-native";
import { useStorefront } from "../../src/api/queries";
import { ErrorState, Loading } from "../../src/components/states";
import { ShopImage } from "../../src/components/shop-card";
import { Button, Card, Screen, SectionTitle, StockBadge, Text } from "../../src/components/ui";
import { appConfig } from "../../src/config";
import { ApiError } from "../../src/lib/api";
import { formatPrice, formatTime12h, MODEL_LABELS } from "../../src/lib/format";
import { isOpenNow } from "../../src/lib/hours";
import { callShop, directionsUrl, openLink, shareShop, whatsappShop } from "../../src/lib/links";
import { radius, space, useColors } from "../../src/theme";

export default function StorefrontScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const c = useColors();
  const q = useStorefront(String(slug ?? ""));

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error) {
    const missing = q.error instanceof ApiError && q.error.code === "NOT_FOUND";
    return (
      <Screen>
        <Stack.Screen options={{ title: "Shop" }} />
        {missing ? (
          <View style={{ padding: space.xl, gap: space.sm }}>
            <Text variant="title">This shop isn&apos;t available</Text>
            <Text muted>It may have been removed, or it is not published yet.</Text>
          </View>
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )}
      </Screen>
    );
  }
  const view = q.data;
  if (!view) return null;
  const { storefront: sf, shop, products } = view;
  const open = isOpenNow(shop.operating_hours);
  const has = (a: string) => sf.supported_actions.includes(a);
  const pin = shop.pincode ?? shop.locality.pincode;

  return (
    <Screen padded={false} edges={[]}>
      <Stack.Screen options={{ title: shop.name }} />
      <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />} contentContainerStyle={{ paddingBottom: space.xxl }}>
        {sf.banner_url ? <Image source={{ uri: sf.banner_url }} alt={`${shop.name} banner`} style={{ width: "100%", height: 150, backgroundColor: c.skeleton }} contentFit="cover" cachePolicy="memory-disk" /> : null}
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <ShopImage uri={sf.logo_url} size={72} label={shop.name} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title">{shop.name}</Text>
              <Text muted>{shop.category.name} · {shop.locality.name}</Text>
              <Text variant="small" style={{ color: open ? c.success : c.muted, fontWeight: "600" }}>{open ? "Open now" : "Closed now"}</Text>
            </View>
          </View>
          {sf.headline ? <Text>{sf.headline}</Text> : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {has("call") ? <Button title="Call" onPress={() => void callShop(shop.phone)} style={{ flexGrow: 1 }} /> : null}
            {has("whatsapp") && shop.whatsapp ? <Button title="WhatsApp" variant="outline" onPress={() => void whatsappShop(shop.whatsapp)} style={{ flexGrow: 1 }} /> : null}
            {has("directions") ? <Button title="Directions" variant="outline" onPress={() => void openLink(directionsUrl(shop), "No maps app is available.")} style={{ flexGrow: 1 }} /> : null}
            <Button title="Share" variant="ghost" onPress={() => void shareShop(appConfig().webUrl, sf.slug, shop.name)} />
          </View>

          {sf.description ? (
            <>
              <SectionTitle>About</SectionTitle>
              <Text>{sf.description}</Text>
            </>
          ) : null}

          <SectionTitle>Visit</SectionTitle>
          <Card>
            <Text>{shop.address_line}</Text>
            {shop.landmark ? <Text muted>Near {shop.landmark}</Text> : null}
            <Text>{shop.locality.name}, Khammam{pin ? ` – ${pin}` : ""}</Text>
            <Text style={{ marginTop: space.sm }}>
              Hours: {formatTime12h(shop.operating_hours.opens)} – {formatTime12h(shop.operating_hours.closes)}
            </Text>
            {shop.operating_hours.closed_days.length ? <Text muted>Closed {shop.operating_hours.closed_days.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}</Text> : null}
            <Text variant="small" muted style={{ marginTop: space.sm }}>{shop.operating_models.map((m) => MODEL_LABELS[m] ?? m).join(" · ")}</Text>
            <Text variant="small" muted>Hours are as provided by the shop. Please call to confirm.</Text>
          </Card>

          {products.length > 0 ? (
            <>
              <SectionTitle>Items</SectionTitle>
              {products.map((p) => (
                <View key={p.id} style={{ flexDirection: "row", gap: space.md, padding: space.md, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.card, marginBottom: space.sm }}>
                  {p.image_url ? <Image source={{ uri: p.image_url }} alt={p.name} style={{ width: 64, height: 64, borderRadius: radius.md }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={p.image_url} /> : null}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontWeight: "600" }}>{p.name}</Text>
                    {p.name_te ? <Text variant="small" muted>{p.name_te}</Text> : null}
                    <Text>
                      {formatPrice(p.price)}
                      {p.price !== null && p.unit ? ` / ${p.unit}` : ""}
                    </Text>
                    <StockBadge status={p.effective_stock_status} />
                  </View>
                </View>
              ))}
              <Text variant="small" muted>Availability and prices are as last confirmed by the shop. Please call before visiting.</Text>
            </>
          ) : null}

          {sf.gallery_urls.length > 0 ? (
            <>
              <SectionTitle>Photos</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {sf.gallery_urls.map((u, i) => (
                  <Image key={u} source={{ uri: u }} alt={`${shop.name} photo ${i + 1}`} style={{ width: 200, height: 150, borderRadius: radius.md, marginRight: space.sm }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={u} />
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}