import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { useAuth } from "@/src/auth";
import { api, Visit, Salesman } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Chip, EmptyState, formatCurrency } from "@/src/components/ui";
import { fmtDateTime } from "@/src/utils/datetime";

export default function VisitsScreen() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<Visit[]>([]);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [salesmanId, setSalesmanId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const params: any = {};
      if (user?.role === "admin" && salesmanId !== "all") params.salesman_id = salesmanId;
      const list = await api.listVisits(token, params);
      setItems(list);
      if (user?.role === "admin" && salesmen.length === 0) {
        const s = await api.listSalesmen(token);
        setSalesmen(s);
      }
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token, salesmanId]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Visits</Text>
        <Text style={styles.count}>{items.length}</Text>
      </View>
      {user?.role === "admin" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipContent}>
          <Chip label="All" active={salesmanId === "all"} onPress={() => setSalesmanId("all")} testID="visit-filter-all" />
          {salesmen.map(s => (
            <Chip key={s.id} label={s.name} active={salesmanId === s.id} onPress={() => setSalesmanId(s.id)} testID={`visit-filter-${s.id}`} />
          ))}
        </ScrollView>
      )}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No visits yet" subtitle="Logged visits will show up here." icon="clipboard-outline" />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => <VisitRow v={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function VisitRow({ v }: { v: Visit }) {
  const color = v.visit_result === "Order" ? colors.success : v.visit_result === "No Order" ? colors.error : colors.warning;
  return (
    <View style={styles.card} testID={`visit-row-${v.id}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.shop}>{v.customer_name}</Text>
        <Text style={styles.meta}>
          {v.salesman_name} • {fmtDateTime(v.visit_date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </Text>
        {!!v.remarks && <Text style={styles.remarks} numberOfLines={2}>{v.remarks}</Text>}
        {!!v.order_amount && v.order_amount > 0 && (
          <Text style={styles.orderAmount}>Order: {formatCurrency(v.order_amount)}</Text>
        )}
      </View>
      <View style={[styles.pill, { backgroundColor: color + "22" }]}>
        <Text style={[styles.pillText, { color }]}>{v.visit_result}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  count: { fontSize: font.base, fontWeight: "700", color: colors.onSurfaceSecondary, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 2, borderRadius: radius.pill },
  chipRow: { flexGrow: 0, maxHeight: 56, backgroundColor: colors.surfaceSecondary },
  chipContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.sm },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  shop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  remarks: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: spacing.xs },
  orderAmount: { color: colors.brandPrimary, fontWeight: "700", marginTop: spacing.xs },
  pill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  pillText: { fontWeight: "700", fontSize: font.sm },
});
