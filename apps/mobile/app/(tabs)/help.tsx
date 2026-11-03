import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, View } from "react-native";
import { useSubmitHelpRequest, useTaxonomy } from "../../src/api/queries";
import { Button, Card, Chip, Field, Screen, SectionTitle, Text } from "../../src/components/ui";
import { ApiError } from "../../src/lib/api";
import { checkHelpRequest, hasErrors } from "../../src/lib/forms";
import { normalizeIndianPhone } from "../../src/lib/format";
import { useSession } from "../../src/state/session";
import { space, useColors } from "../../src/theme";

export default function HelpMeFindIt() {
  const params = useLocalSearchParams<{ item?: string; locality?: string }>();
  const router = useRouter();
  const c = useColors();
  const { state } = useSession();
  const taxonomy = useTaxonomy();
  const submit = useSubmitHelpRequest();

  const [item, setItem] = useState(params.item ?? "");
  // Arriving from a failed search (the tab stays mounted) prefills the item: adjust state when the parameter changes.
  const [seenItem, setSeenItem] = useState(params.item);
  if (params.item !== seenItem) {
    setSeenItem(params.item);
    if (params.item) setItem(params.item);
  }
  const [description, setDescription] = useState("");
  const [localityChoice, setLocalityChoice] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [nameInput, setName] = useState<string | null>(null);
  const [phoneInput, setPhone] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof checkHelpRequest>>({});
  const [done, setDone] = useState<{ tracking_id: string; phone: string } | null>(null);

  // Area: the person's choice, else the one passed from search (resolved once the list has loaded).
  const paramLocalityId = taxonomy.data?.localities.find((x) => x.slug === params.locality)?.id ?? "";
  const localityId = localityChoice ?? paramLocalityId;
  // Signed-in customers get their own details pre-filled (they can still edit them).
  const profile = state.status === "signedIn" ? state.me?.profile : undefined;
  const name = nameInput ?? profile?.full_name ?? "";
  const phone = phoneInput ?? (profile?.phone.replace(/^\+91/, "") ?? "");

  const onSubmit = () => {
    const e = checkHelpRequest({ item_name: item, contact_name: name, contact_phone: phone, locality_id: localityId, consent });
    setErrors(e);
    if (hasErrors(e)) return;
    const normalized = normalizeIndianPhone(phone) as string;
    submit.mutate(
      {
        item_name: item.trim(),
        ...(description.trim() ? { item_description: description.trim() } : {}),
        preferred_locality_id: localityId,
        ...(categoryId ? { category_id: categoryId } : {}),
        contact_name: name.trim(),
        contact_phone: normalized,
        consent_given: true,
      },
      { onSuccess: (r) => setDone({ tracking_id: r.tracking_id, phone: normalized }) },
    );
  };

  const serverError = submit.error instanceof ApiError ? submit.error : null;

  if (done) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.xl }}>
          <Text variant="title">Request received</Text>
          <Card>
            <Text muted>Your tracking ID</Text>
            <Text variant="display" selectable accessibilityLabel={`Tracking ID ${done.tracking_id}`}>{done.tracking_id}</Text>
            <Text muted>Keep this ID. We have not yet confirmed that any shop has this item - we will update the status after our team checks with local shops.</Text>
          </Card>
          <Button title="Track this request" onPress={() => router.push({ pathname: "/requests/track", params: { id: done.tracking_id, phone: done.phone } })} />
          <Button title="Make another request" variant="outline" onPress={() => { setDone(null); setItem(""); setDescription(""); setConsent(false); submit.reset(); }} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }} keyboardShouldPersistTaps="handled">
          <Text variant="title">Help me find it</Text>
          <Text muted>Can&apos;t find something nearby? Tell us. Our local team will look for a shop that has it and update you. Nothing is promised until a shop is confirmed.</Text>
          <Field label="What are you looking for?" value={item} onChangeText={setItem} error={errors.item_name} maxLength={200} />
          <Field label="More details (optional)" value={description} onChangeText={setDescription} multiline maxLength={1000} />

          <View>
            <Text variant="small" style={{ fontWeight: "600", marginBottom: space.xs }}>Your area</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {taxonomy.data?.localities.map((l) => (
                <Chip key={l.id} label={l.name} selected={localityId === l.id} onPress={() => setLocalityChoice(l.id)} />
              ))}
            </ScrollView>
            {errors.locality_id ? <Text variant="small" style={{ color: c.danger }}>{errors.locality_id}</Text> : null}
          </View>
          <View>
            <Text variant="small" style={{ fontWeight: "600", marginBottom: space.xs }}>Category (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {taxonomy.data?.categories.map((x) => (
                <Chip key={x.id} label={x.name} selected={categoryId === x.id} onPress={() => setCategoryId(categoryId === x.id ? "" : x.id)} />
              ))}
            </ScrollView>
          </View>

          <Field label="Your name" value={name} onChangeText={setName} error={errors.contact_name} autoComplete="name" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} error={errors.contact_phone} keyboardType="phone-pad" autoComplete="tel" hint="10-digit Indian mobile number" />

          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Switch value={consent} onValueChange={setConsent} accessibilityLabel="I agree to be contacted about this request" />
            <Text style={{ flex: 1 }}>I agree to be contacted on this number about this request.</Text>
          </View>
          {errors.consent ? <Text variant="small" style={{ color: c.danger }}>{errors.consent}</Text> : null}

          {serverError ? (
            <Text accessibilityRole="alert" style={{ color: c.danger }}>
              {serverError.code === "RATE_LIMITED" ? "You have sent several requests recently. Please try again later." : serverError.code === "NETWORK" ? "You appear to be offline. Your details are still here - try again when you are connected." : serverError.message}
            </Text>
          ) : null}
          <Button title="Send request" onPress={onSubmit} loading={submit.isPending} />
          <SectionTitle>Already asked?</SectionTitle>
          <Button title="Track a request" variant="outline" onPress={() => router.push("/requests/track")} />
          {state.status === "signedIn" ? <Button title="My requests" variant="outline" onPress={() => router.push("/requests")} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}