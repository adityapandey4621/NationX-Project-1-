import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Button, Card, Field, Screen, Text } from "../src/components/ui";
import { AuthFailure, signUp } from "../src/lib/auth";
import { checkSignUp, hasErrors } from "../src/lib/forms";
import { space, useColors } from "../src/theme";

export default function SignUp() {
  const router = useRouter();
  const c = useColors();
  const [v, setV] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [errors, setErrors] = useState<ReturnType<typeof checkSignUp>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (t: string) => setV((p) => ({ ...p, [k]: t }));

  const submit = async () => {
    const e = checkSignUp(v);
    setErrors(e);
    setFormError(undefined);
    if (hasErrors(e)) return;
    setBusy(true);
    try {
      const r = await signUp(v);
      if (r.needsConfirmation) setConfirm(true);
      else router.replace("/(tabs)/account");
    } catch (err) {
      if (err instanceof AuthFailure && err.field) setErrors({ [err.field]: err.message });
      else setFormError(err instanceof AuthFailure ? err.message : "Could not create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (confirm) {
    return (
      <Screen edges={[]}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.xl }}>
          <Card>
            <Text variant="title">Check your email</Text>
            <Text>We sent a confirmation link to {v.email.trim()}. Open it, then come back and sign in.</Text>
          </Card>
          <Button title="Go to sign in" onPress={() => router.replace("/sign-in")} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.xl }} keyboardShouldPersistTaps="handled">
          <Text variant="title">Create your account</Text>
          <Text muted>One account works on the website and in the app.</Text>
          <Field label="Full name" value={v.full_name} onChangeText={set("full_name")} error={errors.full_name} autoComplete="name" />
          <Field label="Email" value={v.email} onChangeText={set("email")} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} />
          <Field label="Mobile number" value={v.phone} onChangeText={set("phone")} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" hint="10-digit Indian mobile number. It is not verified by SMS yet." />
          <Field label="Password" value={v.password} onChangeText={set("password")} error={errors.password} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters" onSubmitEditing={submit} />
          {formError ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{formError}</Text> : null}
          <Button title="Create account" onPress={submit} loading={busy} />
          <Button title="I already have an account" variant="ghost" onPress={() => router.replace("/sign-in")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}