import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, FlatList, RefreshControl, View } from "react-native";
import { useMyBusinesses, useShopProducts } from "../../../../../src/api/queries";
import { useProductMutations } from "../../../../../src/api/merchant";
import { EmptyState, ErrorState, Loading } from "../../../../../src/components/states";
import { Button, Card, Screen, StockBadge, Text } from "../../../../../src/components/ui";
import { ApiError } from "../../../../../src/lib/api";
import { formatPrice, STOCK_LABELS } from "../../../../../src/lib/format";
import { canManage } from "../../../../../src/lib/roles";
import type { StockLabel } from "../../../../../src/lib/types";
import { radius, space } from "../../../../../src/theme";

const STOCKS: StockLabel[] = ["in_stock", "out_of_stock", "call_to_confirm"];

export default function ProductList() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const id = String(shopId);
  const router = useRouter();
  const businesses = useMyBusinesses(true);
  const products = useShopProducts(id);
  const m = useProductMutations(id);
  const role = businesses.data?.find((b) => b.business.shops.some((s) => s.id === id))?.role;
  const editable = role ? canManage(role) : false;

  const fail = (e: unknown) => Alert.alert("Could not save", e instanceof ApiError ? e.message : "Please try again.");

  if (products.isLoading || businesses.isLoading) return <Screen><Loading /></Screen>;
  if (products.error) return <Screen><ErrorState error={products.error} onRetry={() => void products.refetch()} /></Screen>;
  const list = products.data ?? [];
  const stale = list.filter((p) => p.is_published && p.stock_status !== "call_to_confirm" && p.effective_stock_status === "call_to_confirm").length;

  return (
    <Screen edges={[]}>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingVertical: space.lg, gap: space.sm }}
        refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} />}
        ListHeaderComponent={
          <View style={{ gap: space.sm }}>
            {editable ? <Button title="Add an item" onPress={() => router.push({ pathname: "/merchant/shop/[shopId]/products/[productId]", params: { shopId: id, productId: "new" } })} /> : <Text muted>View-only access.</Text>}
            {stale > 0 ? <Card><Text style={{ fontWeight: "600" }}>{stale} {stale === 1 ? "item needs" : "items need"} a fresh stock check</Text><Text variant="small" muted>Customers see “Call to confirm” when stock hasn&apos;t been confirmed in 3 days.</Text></Card> : null}
          </View>
        }
        ListEmptyComponent={<EmptyState title="No items yet" detail="Items you add appear on your public page and in search. Only list what you really sell." />}
        renderItem={({ item: p }) => (
          <Card>
            <View style={{ flexDirection: "row", gap: space.md }}>
              {p.image_url ? <Image source={{ uri: p.image_url }} alt={p.name} style={{ width: 56, height: 56, borderRadius: radius.md }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={p.image_url} /> : null}
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="large" numberOfLines={1}>{p.name}</Text>
                <Text>{formatPrice(p.price)}{p.price !== null && p.unit ? ` / ${p.unit}` : ""}</Text>
                <StockBadge status={p.effective_stock_status} />
                {p.stock_status !== p.effective_stock_status ? <Text variant="small" muted>You set “{STOCK_LABELS[p.stock_status]}” - reconfirm it.</Text> : null}
                {!p.is_published ? <Text variant="small" muted>Hidden from customers</Text> : null}
              </View>
            </View>
            {editable ? (
              <View style={{ gap: space.sm, marginTop: space.sm }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                  {STOCKS.map((s) => (
                    <Button key={s} title={STOCK_LABELS[s]} variant={p.stock_status === s ? "primary" : "outline"} style={{ minHeight: 44, paddingHorizontal: space.md }} loading={m.update.isPending && m.update.variables?.id === p.id && m.update.variables.body.stock_status === s} onPress={() => m.update.mutate({ id: p.id, body: { stock_status: s } }, { onError: fail })} />
                  ))}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                  {p.stock_status !== "call_to_confirm" ? <Button title="Stock is still correct" variant="ghost" onPress={() => m.confirmStock.mutate(p.id, { onError: fail })} /> : null}
                  <Button title={p.is_published ? "Hide" : "Show"} variant="ghost" onPress={() => m.update.mutate({ id: p.id, body: { is_published: !p.is_published } }, { onError: fail })} />
                  <Button title="Edit" variant="ghost" onPress={() => router.push({ pathname: "/merchant/shop/[shopId]/products/[productId]", params: { shopId: id, productId: p.id } })} />
                </View>
              </View>
            ) : null}
          </Card>
        )}
        initialNumToRender={6}
        windowSize={7}
      />
    </Screen>
  );
}