import { useRouter } from "expo-router";
import { RefreshControl, ScrollView, View } from "react-native";
import { useMyApplications, useMyBusinesses } from "../../src/api/queries";
import { EmptyState, ErrorState, Loading } from "../../src/components/states";
import { Button, Card, Screen, SectionTitle, Text } from "../../src/components/ui";
import { appConfig } from "../../src/config";
import { formatDate } from "../../src/lib/format";
import { openLink } from "../../src/lib/links";
import { canManage, roleLabel } from "../../src/lib/roles";
import type { ApplicationStatus } from "../../src/lib/types";
import { useSession } from "../../src/state/session";
import { space, useColors } from "../../src/theme";

const APP_STATUS: Record<ApplicationStatus, string> = {
  draft: "Draft - not submitted",
  submitted: "Submitted - waiting for review",
  correction_requested: "Changes requested",
  approved: "Approved",
  rejected: "Not approved",
  suspended: "Suspended",
};

export default function ShopTab() {
  const router = useRouter();
  const c = useColors();
  const { state } = useSession();
  const signedIn = state.status === "signedIn";
  const businesses = useMyBusinesses(signedIn);
  const applications = useMyApplications(signedIn);

  if (state.status === "loading") return <Screen><Loading /></Screen>;
  if (!signedIn) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.xl }}>
          <Text variant="title">Sell on NationX</Text>
          <Text muted>List your shop for free so customers in Khammam can find you. Sign in to start or to manage your shop.</Text>
          <Button title="Sign in" onPress={() => router.push("/sign-in")} />
          <Button title="Create an account" variant="outline" onPress={() => router.push("/sign-up")} />
        </ScrollView>
      </Screen>
    );
  }
  if (businesses.isLoading || applications.isLoading) return <Screen><Loading /></Screen>;
  if (businesses.error) return <Screen><ErrorState error={businesses.error} onRetry={() => void businesses.refetch()} /></Screen>;

  const refresh = () => {
    void businesses.refetch();
    void applications.refetch();
  };
  const shops = (businesses.data ?? []).flatMap((b) => b.business.shops.map((s) => ({ shop: s, role: b.role, business: b.business.name })));
  const apps = applications.data ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }} refreshControl={<RefreshControl refreshing={businesses.isRefetching} onRefresh={refresh} />}>
        <Text variant="title">{shops.length ? "My shop" : "Sell on NationX"}</Text>

        {shops.map(({ shop, role, business }) => {
          const sf = shop.storefront;
          const offline = sf && sf.visibility_status !== "visible";
          return (
            <Card key={shop.id}>
              <Text variant="large">{shop.name}</Text>
              <Text variant="small" muted>{business} · {shop.category.name} · {shop.locality.name} · {roleLabel(role)}</Text>
              {offline ? (
                <View accessibilityRole="alert" style={{ backgroundColor: c.dangerSoft, padding: space.md, borderRadius: 8, marginTop: space.sm }}>
                  <Text style={{ color: c.danger, fontWeight: "600" }}>Your public page is {sf.visibility_status}</Text>
                  <Text variant="small" style={{ color: c.danger }}>Customers cannot see it.{sf.visibility_reason ? ` Reason: ${sf.visibility_reason}.` : ""} Contact NationX to have it restored.</Text>
                </View>
              ) : null}
              <View style={{ gap: space.sm, marginTop: space.sm }}>
                <Button title={canManage(role) ? "Manage items" : "View items"} onPress={() => router.push({ pathname: "/merchant/shop/[shopId]/products", params: { shopId: shop.id } })} />
                <Button title={canManage(role) ? "Edit shop details" : "View shop details"} variant="outline" onPress={() => router.push({ pathname: "/merchant/shop/[shopId]", params: { shopId: shop.id } })} />
                {sf && !offline ? <Button title="View public page" variant="ghost" onPress={() => router.push({ pathname: "/shop/[slug]", params: { slug: sf.slug } })} /> : null}
              </View>
            </Card>
          );
        })}

        {shops.length === 0 && apps.length === 0 ? (
          <EmptyState title="You haven't listed a shop yet" detail="The shop application takes a few minutes and is completed on the NationX website, where you can also upload your documents. Once approved, your shop appears here." />
        ) : null}

        {apps.length > 0 ? (
          <>
            <SectionTitle>Applications</SectionTitle>
            {apps.map((a) => (
              <Card key={a.id}>
                <Text variant="large">{a.business_name}</Text>
                <Text style={{ fontWeight: "600" }}>{APP_STATUS[a.status]}</Text>
                <Text variant="small" muted>Updated {formatDate(a.updated_at)}</Text>
                {a.status === "correction_requested" && a.correction_notes ? <Text>NationX asks: {a.correction_notes}</Text> : null}
                {a.status === "rejected" && a.rejection_reason ? <Text>Reason: {a.rejection_reason}</Text> : null}
                {a.status === "draft" || a.status === "correction_requested" ? (
                  <Button title="Continue on the website" variant="outline" onPress={() => void openLink(`${appConfig().webUrl}/merchant/applications/${a.id}`, "Could not open the browser.")} />
                ) : null}
              </Card>
            ))}
          </>
        ) : null}

        {shops.length === 0 && !apps.some((a) => a.status === "submitted" || a.status === "draft" || a.status === "correction_requested") ? (
          <Button title="Add your shop on the website" onPress={() => void openLink(`${appConfig().webUrl}/merchant/apply`, "Could not open the browser.")} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}