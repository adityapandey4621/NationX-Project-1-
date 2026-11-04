import { ActivityIndicator, Pressable, StyleSheet, Text as RNText, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { radius, space, TOUCH, type, useColors } from "../theme";
import { STOCK_LABELS } from "../lib/format";
import type { StockLabel } from "../lib/types";

export function Text({ variant = "body", muted, style, ...p }: TextProps & { variant?: keyof typeof type; muted?: boolean }) {
  const c = useColors();
  const weight = variant === "title" || variant === "display" ? "700" : variant === "large" ? "600" : "400";
  return <RNText {...p} style={[{ color: muted ? c.muted : c.text, fontSize: type[variant], fontWeight: weight }, style]} />;
}

export function Screen({ children, padded = true, edges = ["top"] }: { children: ReactNode; padded?: boolean; edges?: ("top" | "bottom")[] }) {
  const c = useColors();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1, paddingHorizontal: padded ? space.lg : 0 }}>{children}</View>
    </SafeAreaView>
  );
}

export function Button({
  title, onPress, variant = "primary", loading, disabled, style, accessibilityLabel,
}: { title: string; onPress: () => void; variant?: "primary" | "outline" | "danger" | "ghost"; loading?: boolean; disabled?: boolean; style?: ViewStyle; accessibilityLabel?: string }) {
  const c = useColors();
  const bg = variant === "primary" ? c.primary : variant === "danger" ? c.danger : "transparent";
  const fg = variant === "primary" ? c.onPrimary : variant === "danger" ? "#FFFFFF" : variant === "outline" ? c.primary : c.primary;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        s.button, { backgroundColor: bg, borderColor: variant === "outline" ? c.primary : bg, opacity: off ? 0.55 : pressed ? 0.85 : 1 }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <RNText style={{ color: fg, fontSize: type.body, fontWeight: "600" }}>{title}</RNText>}
    </Pressable>
  );
}

export function Field({
  label, error, hint, ...p
}: TextInputProps & { label: string; error?: string | undefined; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" style={{ fontWeight: "600" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...p}
        style={[s.input, { color: c.text, borderColor: error ? c.danger : c.border, backgroundColor: c.card }, p.multiline && { minHeight: 96, textAlignVertical: "top" }]}
      />
      {error ? <Text variant="small" style={{ color: c.danger }} accessibilityRole="alert">{error}</Text> : hint ? <Text variant="small" muted>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; label?: string }) {
  const c = useColors();
  const inner = [s.card, { backgroundColor: c.card, borderColor: c.border }, style];
  if (!onPress) return <View style={inner}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [inner, { opacity: pressed ? 0.85 : 1 }]}>
      {children}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[s.chip, { backgroundColor: selected ? c.primary : c.card, borderColor: selected ? c.primary : c.border }]}
    >
      <RNText style={{ color: selected ? c.onPrimary : c.text, fontSize: type.small + 1, fontWeight: "500" }}>{label}</RNText>
    </Pressable>
  );
}

export function StockBadge({ status }: { status: StockLabel }) {
  const c = useColors();
  const [bg, fg] = status === "in_stock" ? [c.successSoft, c.success] : status === "call_to_confirm" ? [c.warnSoft, c.warn] : [c.skeleton, c.muted];
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <RNText style={{ color: fg, fontSize: type.small, fontWeight: "600" }}>{STOCK_LABELS[status]}</RNText>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text variant="large" accessibilityRole="header" style={{ marginTop: space.lg, marginBottom: space.sm }}>{children}</Text>;
}

const s = StyleSheet.create({
  button: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1.5, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  input: { minHeight: TOUCH, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: type.body },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  chip: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center", marginRight: space.sm },
});