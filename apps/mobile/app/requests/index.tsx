import { useRouter } from "expo-router";
import { Alert, FlatList, RefreshControl, View } from "react-native";
import { useCancelRequest, useMyRequests } from "../../src/api/queries";
import { EmptyState, ErrorState, Loading } from "../../src/components/states";
import { Button, Card, Screen, Text } from "../../src/components/ui";
import { formatDate, HELP_STATUS_LABELS } from "../../src/lib/format";
import { useSession } from "../../src/state/session";
import { space } from "../../src/theme";

export default function MyRequests() {
  const router = useRouter();
  const { state } = useSession();
  const signedIn = state.status === "signedIn";
  const q = useMyRequests(signedIn);
  const cancel = useCancelRequest();

  if (state.status === "loading") return <Screen><Loading /></Screen>;
  if (!signedIn) {
    return (
      <Screen>
        <EmptyState title="Sign in to see your requests" detail="Requests you made while signed in appear here. You can also track any request with its ID." action={{ title: "Sign in", onPress: () => router.push("/sign-in") }} />
        <View style={{ paddingHorizontal: space.xl }}><Button title="Track with ID" variant="outline" onPress={() => router.push("/requests/track")} /></View>
      </Screen>
    );
  }
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Screen>;

  return (
    <Screen>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingVertical: space.lg, gap: space.sm }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
        ListEmptyComponent={<EmptyState title="No requests yet" detail="When you ask us to find something it will show up here." action={{ title: "Help me find it", onPress: () => router.push("/(tabs)/help") }} />}
        renderItem={({ item: r }) => (
          <Card>
            <Text variant="large">{r.item_name}</Text>
            <Text variant="small" muted selectable>{r.tracking_id} · {formatDate(r.created_at)}{r.locality ? ` · ${r.locality.name}` : ""}</Text>
            <Text style={{ fontWeight: "600" }}>{HELP_STATUS_LABELS[r.status]}</Text>
            {r.resolution_notes ? <Text muted>{r.resolution_notes}</Text> : null}
            {r.status === "matched" && r.matched_shop?.storefront ? (
              <Button title={`Open ${r.matched_shop.name}`} variant="outline" onPress={() => router.push({ pathname: "/shop/[slug]", params: { slug: r.matched_shop?.storefront?.slug ?? "" } })} />
            ) : null}
            {r.status === "pending" || r.status === "under_review" ? (
              <Button
                title="Cancel request"
                variant="ghost"
                loading={cancel.isPending && cancel.variables === r.id}
                onPress={() => Alert.alert("Cancel this request?", "We will stop looking for this item.", [{ text: "Keep it", style: "cancel" }, { text: "Cancel request", style: "destructive", onPress: () => cancel.mutate(r.id) }])}
              />
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}