import React from "react";
import { View, Text, StyleSheet, Pressable, ViewStyle, StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font } from "@/src/theme";

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[cardStyles.card, style]}>{children}</View>;
}
const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});

export function Chip({
  label, active, onPress, testID,
}: { label: string; active?: boolean; onPress?: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[chipStyles.chip, active && chipStyles.chipActive]}
    >
      <Text style={[chipStyles.text, active && chipStyles.textActive]}>{label}</Text>
    </Pressable>
  );
}
const chipStyles = StyleSheet.create({
  chip: {
    height: 36,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  chipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  text: { color: colors.onSurfaceSecondary, fontSize: font.base, fontWeight: "600" },
  textActive: { color: colors.onBrandTertiary },
});

export function StatCard({
  label, value, icon, accent, testID,
}: { label: string; value: string; icon: React.ComponentProps<typeof Ionicons>["name"]; accent?: string; testID?: string }) {
  return (
    <View style={[statStyles.card, { backgroundColor: accent ? colors.brandTertiary : colors.surface }]} testID={testID}>
      <View style={[statStyles.iconWrap, { backgroundColor: accent || colors.surfaceSecondary }]}>
        <Ionicons name={icon} size={18} color={accent ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
      </View>
      <Text style={statStyles.value} numberOfLines={1}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}
const statStyles = StyleSheet.create({
  card: {
    flex: 1, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.xs, minHeight: 96,
  },
  iconWrap: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  value: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xs },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary },
});

export function EmptyState({ title, subtitle, icon = "cube-outline" }: { title: string; subtitle?: string; icon?: any }) {
  return (
    <View style={emptyStyles.wrap}>
      <View style={emptyStyles.iconBox}>
        <Ionicons name={icon} size={36} color={colors.onSurfaceTertiary} />
      </View>
      <Text style={emptyStyles.title}>{title}</Text>
      {subtitle && <Text style={emptyStyles.sub}>{subtitle}</Text>}
    </View>
  );
}
const emptyStyles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.sm },
  iconBox: {
    width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  title: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: font.base, color: colors.onSurfaceSecondary, textAlign: "center" },
});

export function formatCurrency(n?: number) {
  if (n == null) return "₹0";
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
