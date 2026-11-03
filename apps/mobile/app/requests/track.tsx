import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useTrackRequest } from "../../src/api/queries";
import { Button, Card, Field, Screen, Text } from "../../src/components/ui";
import { ApiError } from "../../src/lib/api";
import { formatDate, HELP_STATUS_LABELS, normalizeIndianPhone } from "../../src/lib/format";
import { space, useColors } from "../../src/theme";

export default function TrackRequest() {
  const params = useLocalSearchParams<{ id?: string; phone?: string }>();
  const router = useRouter();
  const c = useColors();
  const track = useTrackRequest();
  const [id, setId] = useState(params.id ?? "");
  const [phone, setPhone] = useState((params.phone ?? "").replace(/^\+91/, ""));
  const [error, setError] = useState<string | undefined>();

  const run = () => {
    const normalized = normalizeIndianPhone(phone);
    if (!id.trim()) return setError("Enter your tracking ID, e.g. HMF-KHM-202611-0001");
    if (!normalized) return setError("Enter the mobile number you used for the request");
    setError(undefined);
    track.mutate({ tracking_id: id.trim().toUpperCase(), contact_phone: normalized });
  };
  // Coming from "Track this request" right after submitting: look it up immediately.
  const { mutate } = track;
  useEffect(() => {
    const normalized = params.phone ? normalizeIndianPhone(params.phone) : null;
    if (params.id && normalized) mutate({ tracking_id: params.id.toUpperCase(), contact_phone: normalized });
  }, [params.id, params.phone, mutate]);

  const notFound = track.error instanceof ApiError && track.error.code === "NOT_FOUND";
  const r = track.data;
  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }} keyboardShouldPersistTaps="handled">
          <Text muted>Enter the tracking ID we gave you and the mobile number you used.</Text>
          <Field label="Tracking ID" value={id} onChangeText={setId} autoCapitalize="characters" autoCorrect={false} placeholder="HMF-KHM-202611-0001" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          {error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text> : null}
          {notFound ? <Text accessibilityRole="alert" style={{ color: c.danger }}>We could not find a request with those details. Check the ID and number.</Text> : null}
          {track.error && !notFound ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{track.error instanceof ApiError ? track.error.message : "Something went wrong"}</Text> : null}
          <Button title="Check status" onPress={run} loading={track.isPending} />
          {r ? (
            <Card>
              <Text variant="large">{r.item_name}</Text>
              <Text variant="small" muted selectable>{r.tracking_id} · asked {formatDate(r.created_at)}</Text>
              <Text variant="title">{HELP_STATUS_LABELS[r.status]}</Text>
              {r.resolution_notes ? <Text>{r.resolution_notes}</Text> : null}
              {r.status === "matched" && r.matched_shop_slug ? (
                <Button title="Open the shop" onPress={() => router.push({ pathname: "/shop/[slug]", params: { slug: r.matched_shop_slug ?? "" } })} />
              ) : null}
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}