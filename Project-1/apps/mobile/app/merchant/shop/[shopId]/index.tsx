import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useMyBusinesses } from "../../../../src/api/queries";
import { useUpdateShop } from "../../../../src/api/merchant";
import { ErrorState, Loading } from "../../../../src/components/states";
import { Button, Chip, Field, Screen, Text } from "../../../../src/components/ui";
import { ApiError } from "../../../../src/lib/api";
import { MODEL_LABELS, normalizeIndianPhone } from "../../../../src/lib/format";
import { canManage } from "../../../../src/lib/roles";
import type { ManagedShop, MyBusiness, OperatingModel } from "../../../../src/lib/types";
import { space, useColors } from "../../../../src/theme";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const MODELS: OperatingModel[] = ["visit_only", "pickup", "delivery", "appointment", "quotation"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const local = (phone: string | null) => (phone ?? "").replace(/^\+91/, "");

export default function ShopDetails() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const businesses = useMyBusinesses(true);
  const found = businesses.data?.flatMap((b) => b.business.shops.map((s) => ({ shop: s, role: b.role }))).find((x) => x.shop.id === shopId);

  if (businesses.isLoading) return <Screen><Loading /></Screen>;
  if (businesses.error) return <Screen><ErrorState error={businesses.error} onRetry={() => void businesses.refetch()} /></Screen>;
  if (!found) return <Screen><Text variant="large" style={{ padding: space.xl }}>Shop not found</Text></Screen>;
  // Keyed by shop: the form is seeded once per shop and a background refetch never wipes what is being typed.
  return <ShopForm key={found.shop.id} shop={found.shop} role={found.role} />;
}

function ShopForm({ shop, role }: { shop: ManagedShop; role: MyBusiness["role"] }) {
  const c = useColors();
  const update = useUpdateShop(shop.id);
  const editable = canManage(role);
  const [f, setF] = useState({
    phone: local(shop.phone), whatsapp: local(shop.whatsapp), address_line: shop.address_line, landmark: shop.landmark ?? "",
    pincode: shop.pincode ?? "", headline: shop.storefront?.headline ?? "", description: shop.storefront?.description ?? "",
    opens: shop.operating_hours.opens.slice(0, 5), closes: shop.operating_hours.closes.slice(0, 5),
  });
  const [closed, setClosed] = useState<string[]>(shop.operating_hours.closed_days.map((d) => d.toLowerCase()));
  const [models, setModels] = useState<OperatingModel[]>(shop.operating_models);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (t: string) => setF((p) => ({ ...p, [k]: t }));

  const save = () => {
    const errs: Record<string, string> = {};
    const phone = normalizeIndianPhone(f.phone);
    const wa = f.whatsapp.trim() ? normalizeIndianPhone(f.whatsapp) : null;
    if (!phone) errs.phone = "Enter a valid 10-digit Indian mobile number";
    if (f.whatsapp.trim() && !wa) errs.whatsapp = "Enter a valid 10-digit Indian mobile number";
    if (!f.address_line.trim()) errs.address_line = "Enter the shop address";
    if (f.pincode.trim() && !/^[1-9]\d{5}$/.test(f.pincode.trim())) errs.pincode = "Enter a 6-digit PIN code";
    if (!HHMM.test(f.opens)) errs.opens = "Use 24-hour time, e.g. 09:00";
    if (!HHMM.test(f.closes)) errs.closes = "Use 24-hour time, e.g. 21:00";
    if (models.length === 0) errs.models = "Choose at least one way customers can shop";
    setFieldErr(errs);
    setMsg(null);
    if (Object.keys(errs).length > 0 || !phone) return;
    update.mutate(
      {
        phone, whatsapp: wa, address_line: f.address_line.trim(), landmark: f.landmark.trim() || null, pincode: f.pincode.trim() || null,
        operating_hours: { opens: f.opens, closes: f.closes, closed_days: closed }, operating_models: models,
        headline: f.headline.trim() || null, description: f.description.trim() || null,
      },
      {
        onSuccess: () => setMsg({ ok: true, text: "Saved. Your public page is updated." }),
        onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Could not save. Please try again." }),
      },
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: shop.name }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }} keyboardShouldPersistTaps="handled">
          {!editable ? <Text muted>You have view-only access. Only owners and managers can change shop details.</Text> : <Text variant="small" muted>To change the shop name, category or area, contact NationX (these need re-verification).</Text>}
          <Field label="Headline" value={f.headline} onChangeText={set("headline")} editable={editable} maxLength={160} hint="A short line under your shop name, e.g. today's offer" />
          <Field label="Description" value={f.description} onChangeText={set("description")} editable={editable} multiline maxLength={2000} />
          <Field label="Phone" value={f.phone} onChangeText={set("phone")} editable={editable} keyboardType="phone-pad" error={fieldErr.phone} />
          <Field label="WhatsApp (optional)" value={f.whatsapp} onChangeText={set("whatsapp")} editable={editable} keyboardType="phone-pad" error={fieldErr.whatsapp} />
          <Field label="Address" value={f.address_line} onChangeText={set("address_line")} editable={editable} error={fieldErr.address_line} />
          <Field label="Landmark" value={f.landmark} onChangeText={set("landmark")} editable={editable} />
          <Field label="PIN code" value={f.pincode} onChangeText={set("pincode")} editable={editable} keyboardType="number-pad" maxLength={6} error={fieldErr.pincode} />
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ flex: 1 }}><Field label="Opens (24h)" value={f.opens} onChangeText={set("opens")} editable={editable} keyboardType="numbers-and-punctuation" maxLength={5} error={fieldErr.opens} /></View>
            <View style={{ flex: 1 }}><Field label="Closes (24h)" value={f.closes} onChangeText={set("closes")} editable={editable} keyboardType="numbers-and-punctuation" maxLength={5} error={fieldErr.closes} /></View>
          </View>
          <Text variant="small" style={{ fontWeight: "600" }}>Weekly off days</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
            {DAYS.map((d) => <Chip key={d} label={cap(d)} selected={closed.includes(d)} {...(editable ? { onPress: () => setClosed((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d])) } : {})} />)}
          </View>
          <Text variant="small" style={{ fontWeight: "600" }}>How customers can shop</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
            {MODELS.map((m) => <Chip key={m} label={MODEL_LABELS[m] ?? m} selected={models.includes(m)} {...(editable ? { onPress: () => setModels((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m])) } : {})} />)}
          </View>
          {fieldErr.models ? <Text variant="small" style={{ color: c.danger }}>{fieldErr.models}</Text> : null}
          {msg ? <Text accessibilityRole="alert" style={{ color: msg.ok ? c.success : c.danger }}>{msg.text}</Text> : null}
          {editable ? <Button title="Save changes" onPress={save} loading={update.isPending} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}