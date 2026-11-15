import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, OrderDetailed } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState, formatCurrency } from "@/src/components/ui";
import { fmtDate } from "@/src/utils/datetime";

const OUTCOME_COLOR: Record<string, string> = {
  "Order": colors.success, "No Order": colors.error, "Follow-up": colors.warning,
};

export default function BillsScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<OrderDetailed[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token) return;
    try { setItems(await api.listOrders(token)); } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, [token]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}><Text style={styles.headerTitle}>Bills</Text></View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
          ListEmptyComponent={<EmptyState title="No bills yet" subtitle="Tap + to create a bill." icon="receipt-outline" />}
          renderItem={({ item }) => (
            <Pressable style={styles.card} testID={`bill-row-${item.id}`} onPress={() => router.push(`/order/${item.id}`)}>
              <View style={{ flex: 1 }}>
                {!!item.order_number && <Text style={styles.orderNo}>{item.order_number}</Text>}
                <Text style={styles.shop}>{item.customer_name}</Text>
                <Text style={styles.meta}>{item.salesman_name} • {fmtDate(item.order_date, { month: "short", day: "numeric" })}</Text>
                {item.total_amount > 0 && <Text style={styles.amount}>{formatCurrency(item.total_amount)}</Text>}
              </View>
              <View style={[styles.pill, { backgroundColor: (OUTCOME_COLOR[item.outcome || "Order"] || colors.success) + "22" }]}>
                <Text style={[styles.pillText, { color: OUTCOME_COLOR[item.outcome || "Order"] || colors.success }]}>{item.outcome || "Order"}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
      <Pressable testID="bills-fab" onPress={() => router.push("/order/new")} style={styles.fab}>
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerTitle: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  orderNo: { fontSize: font.sm, fontWeight: "800", color: colors.brandPrimary, marginBottom: 2 },
  shop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  amount: { fontSize: font.lg, fontWeight: "800", color: colors.brandPrimary, marginTop: spacing.xs },
  pill: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, minWidth: 84, alignItems: "center" },
  pillText: { fontWeight: "700", fontSize: font.sm },
  fab: { position: "absolute", right: spacing.lg, bottom: spacing.xl, width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6 },
});
