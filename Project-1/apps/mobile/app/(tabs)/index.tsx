import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, ScrollView, View } from "react-native";
import { useHomepage, useTaxonomy } from "../../src/api/queries";
import { EmptyState, ErrorState, Loading } from "../../src/components/states";
import { ShopCard } from "../../src/components/shop-card";
import { Button, Card, Chip, Field, Screen, SectionTitle, Text } from "../../src/components/ui";
import { useLocalityPref } from "../../src/state/locality-pref";
import { space } from "../../src/theme";

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const pref = useLocalityPref();
  const taxonomy = useTaxonomy();
  const locality = taxonomy.data?.localities.find((l) => l.slug === pref.slug);
  const home = useHomepage(locality?.id);

  const submit = () => router.push({ pathname: "/(tabs)/search", params: { q: q.trim(), ...(pref.slug ? { locality: pref.slug } : {}) } });

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.lg }}>
      <Text variant="display">NationX</Text>
      <Text muted>Shops and services in Khammam</Text>
      <Field label="What are you looking for?" value={q} onChangeText={setQ} onSubmitEditing={submit} returnKeyType="search" placeholder="Rice, medicines, electrician…" autoCorrect={false} />
      <Button title="Search" onPress={submit} disabled={!q.trim()} />

      <SectionTitle>Your area</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Chip label="All areas" selected={!pref.slug} onPress={() => pref.setSlug(null)} />
        {taxonomy.data?.localities.map((l) => (
          <Chip key={l.id} label={l.name} selected={pref.slug === l.slug} onPress={() => pref.setSlug(l.slug)} />
        ))}
      </ScrollView>

      {home.data && home.data.categories.length > 0 ? (
        <>
          <SectionTitle>Browse by category</SectionTitle>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {home.data.categories.map((c) => (
              <Card key={c.id} style={{ width: "48%" }} onPress={() => router.push({ pathname: "/(tabs)/search", params: { category: c.slug, ...(pref.slug ? { locality: pref.slug } : {}) } })} label={`${c.name}, ${c.shop_count} shops`}>
                <Text variant="large">{c.name}</Text>
                <Text variant="small" muted>{pref.slug ? "" : `${c.shop_count} ${c.shop_count === 1 ? "shop" : "shops"}`}</Text>
              </Card>
            ))}
          </View>
        </>
      ) : null}
      <SectionTitle>{locality ? `New in ${locality.name}` : "Recently added shops"}</SectionTitle>
    </View>
  );

  const footer = (
    <View style={{ gap: space.md, paddingVertical: space.xl }}>
      <Card>
        <Text variant="large">Can&apos;t find something?</Text>
        <Text muted>Tell us what you need and our local team will look for a shop.</Text>
        <Button title="Help me find it" variant="outline" onPress={() => router.push("/(tabs)/help")} style={{ marginTop: space.sm }} />
      </Card>
    </View>
  );

  if (home.isLoading && !home.data) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <FlatList
        data={home.data?.featured_shops ?? []}
        keyExtractor={(s) => s.storefront_id}
        renderItem={({ item }) => <View style={{ marginBottom: space.sm }}><ShopCard shop={item} /></View>}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          home.error ? (
            <ErrorState error={home.error} onRetry={() => void home.refetch()} />
          ) : (
            <EmptyState title="No shops are listed yet" detail="NationX is onboarding local shops. Shops appear here once they have been verified." />
          )
        }
        refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={() => void home.refetch()} />}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        windowSize={7}
      />
    </Screen>
  );
}