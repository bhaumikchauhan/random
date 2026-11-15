import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable,
  ActivityIndicator, RefreshControl, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Customer } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Chip, EmptyState, formatCurrency } from "@/src/components/ui";

const STATUS_OPTIONS = ["All", "Active", "Inactive"];

export default function CustomersScreen() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");

  const load = async () => {
    if (!token) return;
    try {
      const data = await api.listCustomers(token, {
        q: q || undefined,
        status: status !== "All" ? status : undefined,
      });
      setItems(data);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token, q, status]));

  const areas = useMemo(() => {
    const set = new Set<string>();
    items.forEach(c => { if (c.area) set.add(c.area); });
    return ["All", ...Array.from(set)];
  }, [items]);
  const [area, setArea] = useState("All");
  const filtered = area === "All" ? items : items.filter(c => c.area === area);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Customers</Text>
        <Text style={styles.count}>{filtered.length}</Text>
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.onSurfaceSecondary} />
        <TextInput
          testID="customers-search-input"
          value={q}
          onChangeText={setQ}
          placeholder="Search shop, owner, mobile..."
          placeholderTextColor={colors.onSurfaceTertiary}
          style={styles.search}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipContent}
      >
        {STATUS_OPTIONS.map(s => (
          <Chip key={s} label={s} active={status === s} onPress={() => setStatus(s)} testID={`filter-status-${s}`} />
        ))}
        <View style={styles.divider} />
        {areas.map(a => (
          <Chip key={a} label={a} active={area === a} onPress={() => setArea(a)} testID={`filter-area-${a}`} />
        ))}
      </ScrollView>

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, paddingTop: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No customers" subtitle="Tap the + button to add your first customer." icon="storefront-outline" />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => <CustomerRow c={item} onPress={() => router.push(`/customer/${item.id}`)} />}
        />
      )}

      <Pressable
        testID="fab-add-customer"
        onPress={() => router.push("/customer/new")}
        style={styles.fab}
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </SafeAreaView>
  );
}

function CustomerRow({ c, onPress }: { c: Customer; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} testID={`customer-row-${c.id}`} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{c.shop_name?.[0]?.toUpperCase() || "?"}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.shop} numberOfLines={1}>{c.shop_name}</Text>
          {(c.approval_status || "approved") === "pending" && (
            <View style={styles.pendingChip} testID={`pending-${c.id}`}>
              <Text style={styles.pendingChipText}>Pending</Text>
            </View>
          )}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {c.owner_name || "—"}{c.area ? ` • ${c.area}` : ""}
        </Text>
        {!!c.salesman_name && <Text style={styles.subSalesman} numberOfLines={1}>👤 {c.salesman_name}</Text>}
      </View>
      {!!(c.outstanding && c.outstanding > 0) && (
        <View style={styles.outBadge}>
          <Text style={styles.outText}>{formatCurrency(c.outstanding)}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  count: { fontSize: font.base, fontWeight: "700", color: colors.onSurfaceSecondary, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 2, borderRadius: radius.pill },
  searchWrap: {
    marginHorizontal: spacing.lg, marginTop: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44,
  },
  search: { flex: 1, color: colors.onSurface, fontSize: font.base },
  chipRow: { flexGrow: 0, maxHeight: 56, marginTop: spacing.sm, backgroundColor: colors.surfaceSecondary },
  chipContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.sm },
  divider: { width: 1, height: 24, backgroundColor: colors.borderStrong, marginHorizontal: spacing.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: font.lg },
  shop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  subSalesman: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  outBadge: { backgroundColor: "#FEE2E2", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  outText: { color: colors.error, fontWeight: "700", fontSize: font.sm },
  pendingChip: { backgroundColor: "#FEF3C7", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pendingChipText: { color: colors.warning, fontWeight: "700", fontSize: 10 },
  fab: {
    position: "absolute", right: spacing.lg, bottom: 88,
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});
