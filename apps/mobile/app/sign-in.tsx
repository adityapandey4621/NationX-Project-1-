import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Button, Field, Screen, Text } from "../src/components/ui";
import { AuthFailure, signIn } from "../src/lib/auth";
import { checkSignIn, hasErrors } from "../src/lib/forms";
import { space, useColors } from "../src/theme";

export default function SignIn() {
  const router = useRouter();
  const c = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof checkSignIn>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e = checkSignIn({ email, password });
    setErrors(e);
    setFormError(undefined);
    if (hasErrors(e)) return;
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace("/(tabs)/account");
    } catch (err) {
      setFormError(err instanceof AuthFailure ? err.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.xl }} keyboardShouldPersistTaps="handled">
          <Text variant="title">Welcome back</Text>
          <Text muted>Use the same account as the NationX website.</Text>
          <Field label="Email" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} textContentType="username" />
          <Field label="Password" value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
          {formError ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{formError}</Text> : null}
          <Button title="Sign in" onPress={submit} loading={busy} />
          <Button title="Create an account" variant="ghost" onPress={() => router.replace("/sign-up")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}