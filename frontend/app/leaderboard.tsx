import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, LeaderRow } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState, formatCurrency } from "@/src/components/ui";

const PERIODS: { l: string; v: "today" | "week" | "month" }[] = [
  { l: "Today", v: "today" }, { l: "This Week", v: "week" }, { l: "This Month", v: "month" },
];
const MEDALS = ["#F59E0B", "#94A3B8", "#B45309"];

export default function Leaderboard() {
  const { token } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<"today" | "week" | "month">("week");
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token) return;
    try {
      const res = await api.leaderboard(token, period);
      setRows(res.rows);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token, period]));

  const top = rows.filter(r => r.active || r.sales > 0 || r.visits > 0);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="leaderboard-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Leaderboard</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.segment}>
        {PERIODS.map(p => (
          <Pressable key={p.v} testID={`period-${p.v}`} onPress={() => setPeriod(p.v)}
            style={[styles.segItem, period === p.v && styles.segItemActive]}>
            <Text style={[styles.segText, period === p.v && styles.segTextActive]}>{p.l}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={top}
          keyExtractor={(r) => r.salesman_id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No data yet" subtitle="Rankings appear once salesmen log visits and orders." icon="trophy-outline" />}
          renderItem={({ item }) => (
            <View style={[styles.card, item.rank <= 3 && { borderColor: MEDALS[item.rank - 1] }]} testID={`leader-row-${item.salesman_id}`}>
              <View style={[styles.rankBadge, { backgroundColor: item.rank <= 3 ? MEDALS[item.rank - 1] : colors.surfaceTertiary }]}>
                <Text style={[styles.rankText, { color: item.rank <= 3 ? colors.onSurfaceInverse : colors.onSurfaceSecondary }]}>{item.rank}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.area}>{item.area || "—"}</Text>
              </View>
              <View style={styles.stats}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{item.visits}</Text>
                  <Text style={styles.statLabel}>visits</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: colors.brandPrimary }]}>{formatCurrency(item.sales)}</Text>
                  <Text style={styles.statLabel}>{item.orders} orders</Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: 3, margin: spacing.lg, marginBottom: spacing.sm },
  segItem: { flex: 1, paddingVertical: spacing.sm, alignItems: "center", borderRadius: radius.sm },
  segItemActive: { backgroundColor: colors.surface },
  segText: { fontSize: font.base, color: colors.onSurfaceSecondary, fontWeight: "600" },
  segTextActive: { color: colors.brandPrimary },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  rankBadge: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  rankText: { fontWeight: "800", fontSize: font.lg },
  name: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  area: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  stats: { flexDirection: "row", gap: spacing.md },
  statBox: { alignItems: "center", minWidth: 60 },
  statValue: { fontSize: font.base, fontWeight: "800", color: colors.onSurface },
  statLabel: { fontSize: 10, color: colors.onSurfaceSecondary, marginTop: 2 },
});
