import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useUpdateProfile } from "../../src/api/queries";
import { ErrorState, Loading } from "../../src/components/states";
import { Button, Card, Field, Screen, SectionTitle, Text } from "../../src/components/ui";
import { ApiError } from "../../src/lib/api";
import { normalizeIndianPhone } from "../../src/lib/format";
import { useSession } from "../../src/state/session";
import { space, useColors } from "../../src/theme";

export default function Account() {
  const router = useRouter();
  const c = useColors();
  const { state, signOut } = useSession();
  const update = useUpdateProfile();
  const profile = state.status === "signedIn" ? state.me?.profile : undefined;
  // Unsaved edits live in state that starts empty; the saved profile shows until the person types.
  const [nameInput, setName] = useState<string | null>(null);
  const [phoneInput, setPhone] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const name = nameInput ?? profile?.full_name ?? "";
  const phone = phoneInput ?? (profile?.phone.replace(/^\+91/, "") ?? "");

  if (state.status === "loading") return <Screen><Loading /></Screen>;
  if (state.status === "signedOut") {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.xl }}>
          <Text variant="title">Your NationX account</Text>
          <Text muted>Sign in to track your requests and, if you own a shop, manage it. Browsing and searching need no account.</Text>
          <Button title="Sign in" onPress={() => router.push("/sign-in")} />
          <Button title="Create an account" variant="outline" onPress={() => router.push("/sign-up")} />
        </ScrollView>
      </Screen>
    );
  }
  if (state.meLoading && !state.me) return <Screen><Loading /></Screen>;
  if (!state.me) return <Screen><ErrorState error={state.meError} onRetry={state.reloadMe} /></Screen>;

  const save = () => {
    const normalized = normalizeIndianPhone(phone);
    if (!name.trim()) return setMsg({ ok: false, text: "Enter your name" });
    if (!normalized) return setMsg({ ok: false, text: "Enter a valid 10-digit Indian mobile number" });
    setMsg(null);
    update.mutate(
      { full_name: name.trim(), phone: normalized },
      {
        onSuccess: () => setMsg({ ok: true, text: "Saved." }),
        onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? (e.fieldMessage("phone") ?? e.message) : "Could not save. Please try again." }),
      },
    );
  };

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You will need to sign in again to see your requests or manage a shop.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }} keyboardShouldPersistTaps="handled">
          <Text variant="title">Account</Text>
          <Card>
            <Text muted>Signed in as</Text>
            <Text variant="large">{state.me.profile.email ?? state.email}</Text>
            <Text variant="small" muted>
              {state.me.roles.includes("merchant") ? "Shop owner / staff" : "Customer"} · same account as the website
            </Text>
          </Card>
          <SectionTitle>Your details</SectionTitle>
          <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
          {msg ? <Text accessibilityRole="alert" style={{ color: msg.ok ? c.success : c.danger }}>{msg.text}</Text> : null}
          <Button title="Save changes" onPress={save} loading={update.isPending} />
          <SectionTitle>Shortcuts</SectionTitle>
          <Button title="My requests" variant="outline" onPress={() => router.push("/requests")} />
          <Button title="Sign out" variant="ghost" onPress={confirmSignOut} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}