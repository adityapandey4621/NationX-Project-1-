import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, View } from "react-native";
import { useMyBusinesses, useShopProducts } from "../../../../../src/api/queries";
import { useProductMutations, type ProductBody } from "../../../../../src/api/merchant";
import { ErrorState, Loading } from "../../../../../src/components/states";
import { Button, Chip, Field, Screen, Text } from "../../../../../src/components/ui";
import { ApiError } from "../../../../../src/lib/api";
import { parseMoney, STOCK_LABELS } from "../../../../../src/lib/format";
import { pickFromLibrary, takePhoto, type PickedImage } from "../../../../../src/lib/image-picker";
import { canManage } from "../../../../../src/lib/roles";
import type { Product, StockLabel } from "../../../../../src/lib/types";
import { radius, space, useColors } from "../../../../../src/theme";

const STOCKS: StockLabel[] = ["in_stock", "out_of_stock", "call_to_confirm"];

export default function ProductEditor() {
  const { shopId, productId } = useLocalSearchParams<{ shopId: string; productId: string }>();
  const sid = String(shopId);
  const isNew = productId === "new";
  const businesses = useMyBusinesses(true);
  const products = useShopProducts(sid);
  const role = businesses.data?.find((b) => b.business.shops.some((s) => s.id === sid))?.role;
  const product = isNew ? undefined : products.data?.find((p) => p.id === productId);

  if (businesses.isLoading || (!isNew && products.isLoading)) return <Screen><Loading /></Screen>;
  if (products.error) return <Screen><ErrorState error={products.error} onRetry={() => void products.refetch()} /></Screen>;
  if (!role || !canManage(role)) return <Screen><Text variant="large" style={{ padding: space.xl }}>Only owners and managers can change items.</Text></Screen>;
  if (!isNew && !product) return <Screen><Text variant="large" style={{ padding: space.xl }}>Item not found</Text></Screen>;
  // Keyed by item: seeded once, so a background refetch never overwrites what is being typed.
  return <ProductForm key={product?.id ?? "new"} shopId={sid} product={product} />;
}

function ProductForm({ shopId: sid, product }: { shopId: string; product: Product | undefined }) {
  const isNew = !product;
  const router = useRouter();
  const c = useColors();
  const m = useProductMutations(sid);
  const [f, setF] = useState({
    name: product?.name ?? "", name_te: product?.name_te ?? "", description: product?.description ?? "",
    price: product?.price?.toString() ?? "", mrp: product?.mrp?.toString() ?? "", unit: product?.unit ?? "",
  });
  const [stock, setStock] = useState<StockLabel>(product?.stock_status ?? "call_to_confirm");
  const [published, setPublished] = useState(product?.is_published ?? true);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [photo, setPhoto] = useState<PickedImage | null>(null);  const set = (k: keyof typeof f) => (t: string) => setF((p) => ({ ...p, [k]: t }));

  const save = () => {
    const price = parseMoney(f.price);
    const mrp = parseMoney(f.mrp);
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Enter the item name";
    if (Number.isNaN(price)) e.price = "Enter an amount like 45 or 45.50";
    if (Number.isNaN(mrp)) e.mrp = "Enter an amount like 50 or 50.50";
    if (price !== null && mrp !== null && !Number.isNaN(price) && !Number.isNaN(mrp) && mrp < price) e.mrp = "MRP cannot be lower than the price";
    setErrs(e);
    setMsg(null);
    if (Object.keys(e).length > 0) return;
    const body: ProductBody = {
      name: f.name.trim(), name_te: f.name_te.trim() || null, description: f.description.trim() || null,
      price, mrp, unit: f.unit.trim() || null, stock_status: stock, is_published: published,
    };
    const onError = (err: unknown) => {
      if (err instanceof ApiError) {
        const fe: Record<string, string> = {};
        for (const d of err.details) fe[d.field] = d.message;
        setErrs(fe);
        setMsg({ ok: false, text: err.details.length ? "Please fix the highlighted fields." : err.message });
      } else setMsg({ ok: false, text: "Could not save. Please try again." });
    };
    if (isNew) m.create.mutate(body, { onSuccess: () => router.back(), onError });
    else m.update.mutate({ id: product?.id ?? "", body }, { onSuccess: () => setMsg({ ok: true, text: "Saved." }), onError });
  };

  const upload = (picked: PickedImage | null) => {
    if (!picked || !product) return;
    setPhoto(picked); // show it immediately while it uploads
    m.uploadImage.mutate(
      { id: product.id, uri: picked.uri, mimeType: picked.mimeType },
      { onSuccess: () => setMsg({ ok: true, text: "Photo uploaded." }), onError: (err) => { setPhoto(null); setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Upload failed. Check your connection and try again." }); } },
    );
  };
  const remove = () =>
    Alert.alert("Delete this item?", "It will be removed from your public page and from search.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => m.remove.mutate(product?.id ?? "", { onSuccess: () => router.back(), onError: (err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Could not delete." }) }) },
    ]);

  const imageUri = photo?.uri ?? product?.image_url ?? null;
  const busy = m.create.isPending || m.update.isPending;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: isNew ? "New item" : "Edit item" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }} keyboardShouldPersistTaps="handled">
          <Field label="Item name" value={f.name} onChangeText={set("name")} error={errs.name} maxLength={160} />
          <Field label="Telugu name (optional)" value={f.name_te} onChangeText={set("name_te")} error={errs.name_te} maxLength={160} hint="Helps customers who search in Telugu" />
          <Field label="Description (optional)" value={f.description} onChangeText={set("description")} error={errs.description} multiline maxLength={1000} />
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ flex: 1 }}><Field label="Price ₹" value={f.price} onChangeText={set("price")} error={errs.price} keyboardType="decimal-pad" hint="Blank = “Call for price”" /></View>
            <View style={{ flex: 1 }}><Field label="MRP ₹" value={f.mrp} onChangeText={set("mrp")} error={errs.mrp} keyboardType="decimal-pad" /></View>
          </View>
          <Field label="Unit (optional)" value={f.unit} onChangeText={set("unit")} maxLength={30} hint="e.g. kg, pack, litre" />
          <Text variant="small" style={{ fontWeight: "600" }}>Availability</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {STOCKS.map((s) => <Chip key={s} label={STOCK_LABELS[s]} selected={stock === s} onPress={() => setStock(s)} />)}
          </View>
          <Text variant="small" muted>Customers see “In stock” or “Out of stock” for 3 days after you confirm it, then “Call to confirm”.</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Switch value={published} onValueChange={setPublished} accessibilityLabel="Show on my public page" />
            <Text style={{ flex: 1 }}>Show on my public page</Text>
          </View>
          {msg ? <Text accessibilityRole="alert" style={{ color: msg.ok ? c.success : c.danger }}>{msg.text}</Text> : null}
          <Button title={isNew ? "Add item" : "Save item"} onPress={save} loading={busy} />

          {!isNew ? (
            <>
              <Text variant="large" style={{ marginTop: space.lg }}>Photo</Text>
              {imageUri ? <Image source={{ uri: imageUri }} alt="Item photo" style={{ width: 160, height: 160, borderRadius: radius.md }} contentFit="cover" /> : <Text muted>No photo yet.</Text>}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                <Button title="Choose from gallery" variant="outline" loading={m.uploadImage.isPending} onPress={() => void pickFromLibrary().then(upload)} />
                <Button title="Take a photo" variant="outline" disabled={m.uploadImage.isPending} onPress={() => void takePhoto().then(upload)} />
                {product?.image_url ? <Button title="Remove photo" variant="ghost" onPress={() => m.removeImage.mutate(product.id, { onSuccess: () => setPhoto(null) })} /> : null}
              </View>
              <Button title="Delete item" variant="danger" onPress={remove} style={{ marginTop: space.xl }} />
            </>
          ) : (
            <Text variant="small" muted>You can add a photo after saving the item.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}