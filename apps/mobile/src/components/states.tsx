import { ActivityIndicator, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { space, useColors } from "../theme";
import { Button, Text } from "./ui";

export function Loading({ label = "Loading…" }: { label?: string }) {
  const c = useColors();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ padding: space.xxl, alignItems: "center", gap: space.md }}>
      <ActivityIndicator color={c.primary} size="large" />
      <Text muted>{label}</Text>
    </View>
  );
}

/** Plain-language message for any failure; connectivity problems get an offline-specific hint. */
export function describeError(error: unknown): { title: string; detail: string; retryable: boolean } {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK") return { title: "You're offline", detail: "Check your internet connection and try again.", retryable: true };
    if (error.code === "TIMEOUT") return { title: "That took too long", detail: "The server is slow right now. Please try again.", retryable: true };
    if (error.code === "RATE_LIMITED") return { title: "Please slow down", detail: error.message, retryable: true };
    if (error.code === "NOT_FOUND") return { title: "Not found", detail: error.message, retryable: false };
    if (error.code === "FORBIDDEN") return { title: "Not allowed", detail: error.message, retryable: false };
    if (error.code === "UNAUTHENTICATED") return { title: "Please sign in", detail: "Your session has ended.", retryable: false };
    return { title: "Something went wrong", detail: error.message, retryable: error.retryable };
  }
  return { title: "Something went wrong", detail: "Please try again.", retryable: true };
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const c = useColors();
  const d = describeError(error);
  return (
    <View accessibilityRole="alert" style={{ padding: space.xl, alignItems: "center", gap: space.sm }}>
      <Text variant="large" style={{ color: c.danger }}>{d.title}</Text>
      <Text muted style={{ textAlign: "center" }}>{d.detail}</Text>
      {d.retryable && onRetry ? <Button title="Try again" variant="outline" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: { title: string; onPress: () => void } }) {
  return (
    <View style={{ padding: space.xl, alignItems: "center", gap: space.sm }}>
      <Text variant="large" style={{ textAlign: "center" }}>{title}</Text>
      {detail ? <Text muted style={{ textAlign: "center" }}>{detail}</Text> : null}
      {action ? <Button title={action.title} onPress={action.onPress} /> : null}
    </View>
  );
}

/** Shows a banner while the device has no connection; cached discovery data keeps working underneath. */
export function OfflineBanner() {
  const c = useColors();
  const [offline, setOffline] = useState(false);
  useEffect(
    () => NetInfo.addEventListener((s) => setOffline(s.isConnected === false || s.isInternetReachable === false)),
    [],
  );
  if (!offline) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: c.warnSoft, paddingVertical: 6, paddingHorizontal: space.lg }}>
      <Text variant="small" style={{ color: c.warn, fontWeight: "600" }}>No internet - showing saved information where available</Text>
    </View>
  );
}