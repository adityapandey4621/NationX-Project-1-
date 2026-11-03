import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useItemSearch, useShopSearch, useTaxonomy } from "../../src/api/queries";
import { EmptyState, ErrorState, Loading } from "../../src/components/states";
import { ShopCard } from "../../src/components/shop-card";
import { Button, Chip, Field, Screen, SectionTitle, StockBadge, Text } from "../../src/components/ui";
import { useDebounced } from "../../src/lib/debounce";
import { formatPrice } from "../../src/lib/format";
import type { ProductResult } from "../../src/lib/types";
import { radius, space, useColors } from "../../src/theme";

function ItemRow({ p }: { p: ProductResult }) {
  const router = useRouter();
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${formatPrice(p.price)}, sold by ${p.shop_name}`}
      onPress={() => router.push({ pathname: "/shop/[slug]", params: { slug: p.storefront_slug } })}
      style={{ flexDirection: "row", gap: space.md, padding: space.md, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.card, marginBottom: space.sm }}
    >
      {p.image_url ? <Image source={{ uri: p.image_url }} alt={p.name} style={{ width: 56, height: 56, borderRadius: radius.md }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={p.image_url} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontWeight: "600" }}>{p.name}{p.name_te ? `  ${p.name_te}` : ""}</Text>
        <Text variant="small">{formatPrice(p.price)}{p.price !== null && p.unit ? ` / ${p.unit}` : ""}</Text>
        <StockBadge status={p.effective_stock_status} />
        <Text variant="small" muted numberOfLines={1}>{p.shop_name} · {p.locality_name}</Text>
      </View>
    </Pressable>
  );
}

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string; category?: string; locality?: string }>();
  const router = useRouter();
  const [text, setText] = useState(params.q ?? "");
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [locality, setLocality] = useState<string | undefined>(params.locality);

  // Arriving from Home with new parameters updates the screen (the tab stays mounted).
  const paramKey = `${params.q ?? ""}|${params.category ?? ""}|${params.locality ?? ""}`;
  const [seenKey, setSeenKey] = useState(paramKey);
  if (paramKey !== seenKey) {
    setSeenKey(paramKey);
    setText(params.q ?? "");
    setCategory(params.category);
    setLocality(params.locality);
  }

  const taxonomy = useTaxonomy();
  const q = useDebounced(text.trim());
  const categoryId = taxonomy.data?.categories.find((c) => c.slug === category)?.id;
  const localityId = taxonomy.data?.localities.find((l) => l.slug === locality)?.id;
  const filters = useMemo(() => ({ ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}), ...(localityId ? { localityId } : {}) }), [q, categoryId, localityId]);
  const hasFilter = Boolean(q || categoryId || localityId);

  const shops = useShopSearch(filters);
  const items = useItemSearch(q, { ...(categoryId ? { categoryId } : {}), ...(localityId ? { localityId } : {}) });
  const rows = shops.data?.pages.flatMap((p) => p.results) ?? [];
  const total = shops.data?.pages[0]?.total ?? 0;

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.lg }}>
      <Field label="Search shops and items" value={text} onChangeText={setText} placeholder="Name, item, area or PIN code" returnKeyType="search" autoCorrect={false} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {taxonomy.data?.categories.map((c) => (
          <Chip key={c.id} label={c.name} selected={category === c.slug} onPress={() => setCategory(category === c.slug ? undefined : c.slug)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {taxonomy.data?.localities.map((l) => (
          <Chip key={l.id} label={l.name} selected={locality === l.slug} onPress={() => setLocality(locality === l.slug ? undefined : l.slug)} />
        ))}
      </ScrollView>
      {items.data && items.data.results.length > 0 ? (
        <>
          <SectionTitle>Items for “{q}”</SectionTitle>
          {items.data.results.map((p) => (
            <ItemRow key={p.product_id} p={p} />
          ))}
        </>
      ) : null}
      {rows.length > 0 ? (
        <SectionTitle>{`${total} ${total === 1 ? "shop" : "shops"}`}</SectionTitle>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(s) => s.storefront_id}
        renderItem={({ item }) => <View style={{ marginBottom: space.sm }}><ShopCard shop={item} /></View>}
        ListHeaderComponent={header}
        ListEmptyComponent={
          shops.isLoading ? (
            <Loading label="Searching…" />
          ) : shops.error ? (
            <ErrorState error={shops.error} onRetry={() => void shops.refetch()} />
          ) : hasFilter ? (
            <View>
              <EmptyState title="No shops found" detail="Try a different spelling or fewer words. Shops appear here only after NationX has verified them." />
              <View style={{ paddingHorizontal: space.xl }}>
                <Button title="Ask us to find it" onPress={() => router.push({ pathname: "/(tabs)/help", params: { item: q, ...(locality ? { locality } : {}) } })} />
              </View>
            </View>
          ) : (
            <EmptyState title="No shops are listed yet" detail="Shops appear here once they have been verified." />
          )
        }
        ListFooterComponent={shops.isFetchingNextPage ? <Loading label="Loading more…" /> : <View style={{ height: space.xl }} />}
        onEndReached={() => { if (shops.hasNextPage && !shops.isFetchingNextPage) void shops.fetchNextPage(); }}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        windowSize={7}
      />
    </Screen>
  );
}