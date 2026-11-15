import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Dashboard } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Card, StatCard, formatCurrency, EmptyState } from "@/src/components/ui";
import { fmtDateTime } from "@/src/utils/datetime";

export default function AdminDashboard() {
  const { token, user, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const [d, pending] = await Promise.all([
        api.dashboard(token),
        api.listCustomers(token, { approval: "pending" }),
      ]);
      setData(d);
      setPendingCount(pending.length);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Hello, {user?.name?.split(" ")[0]}</Text>
          <Text style={styles.title}>Dashboard</Text>
        </View>
        <Pressable onPress={logout} style={styles.iconBtn} testID="logout-btn">
          <Ionicons name="log-out-outline" size={22} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      {loading && !data ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          <View style={styles.row}>
            <StatCard testID="stat-today-visits" label="Today's Bills" value={String(data?.todays_visits || 0)} icon="receipt" />
            <StatCard testID="stat-customers" label="Total Customers" value={String(data?.total_customers || 0)} icon="storefront" />
          </View>
          <View style={styles.row}>
            <StatCard testID="stat-salesmen" label="Active Salesmen" value={String(data?.active_salesmen || 0)} icon="people" />
            <StatCard testID="stat-outstanding" label="Outstanding" value={formatCurrency(data?.total_outstanding || 0)} icon="cash" accent={colors.error} />
          </View>
          <View style={styles.row}>
            <StatCard testID="stat-revenue" label="Today's Revenue" value={formatCurrency(data?.todays_revenue || 0)} icon="trending-up" accent={colors.brandPrimary} />
            <View style={{ flex: 1 }} />
          </View>

          <View style={styles.actionRow}>
            <ActionTile testID="quick-add-customer" icon="person-add" label="Add Customer" onPress={() => router.push("/customer/new")} />
            <ActionTile testID="quick-approvals" icon="checkmark-done" label="Approvals" onPress={() => router.push("/approvals")} badge={pendingCount} />
            <ActionTile testID="quick-orders" icon="receipt" label="Bills" onPress={() => router.push("/orders")} />
          </View>
          <View style={styles.actionRow}>
            <ActionTile testID="quick-outstanding" icon="alert-circle" label="Dues" onPress={() => router.push("/outstanding")} />
            <ActionTile testID="quick-leaderboard" icon="trophy" label="Ranking" onPress={() => router.push("/leaderboard")} />
            <ActionTile testID="quick-attendance" icon="finger-print" label="Attendance" onPress={() => router.push("/attendance")} />
          </View>
          <View style={styles.actionRow}>
            <ActionTile testID="quick-salesmen" icon="briefcase" label="Salesmen" onPress={() => router.push("/salesmen")} />
            <ActionTile testID="quick-map" icon="map" label="Live Map" onPress={() => router.push("/(admin)/map")} />
            <ActionTile testID="quick-no-order" icon="close-circle" label="No Orders" onPress={() => router.push("/no-order")} badge={data?.no_order_today || 0} />
          </View>

          <Text style={styles.sectionTitle}>Recent Bills</Text>
          {(!data?.recent_visits || data.recent_visits.length === 0) ? (
            <Card><EmptyState title="No bills yet" subtitle="Bills created by your salesmen will appear here." icon="receipt-outline" /></Card>
          ) : (
            data.recent_visits.map((v: any) => (
              <Card key={v.id} style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.visitShop} numberOfLines={1}>{v.customer_name}</Text>
                    <Text style={styles.visitMeta}>{v.salesman_name} • {fmtDateTime(v.order_date || v.visit_date, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</Text>
                  </View>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{v.outcome || v.visit_result || "Order"}</Text>
                  </View>
                </View>
                {!!v.total_amount && <Text style={styles.orderAmt}>Amount: {formatCurrency(v.total_amount)}</Text>}
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ActionTile({ icon, label, onPress, testID, badge }: any) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.7 }]}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={colors.brandPrimary} />
        {badge > 0 && (
          <View style={styles.tileBadge}><Text style={styles.tileBadgeText}>{badge > 9 ? "9+" : badge}</Text></View>
        )}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  hello: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  iconBtn: { padding: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  row: { flexDirection: "row", gap: spacing.md },
  sectionTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.xs },
  visitShop: { fontSize: font.lg, fontWeight: "600", color: colors.onSurface },
  visitMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  pill: { backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  pillText: { color: colors.onBrandTertiary, fontSize: font.sm, fontWeight: "700" },
  orderAmt: { marginTop: spacing.xs, color: colors.brandPrimary, fontWeight: "700", fontSize: font.base },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  actionTile: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: "center", gap: spacing.xs,
  },
  actionIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  tileBadge: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.warning, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tileBadgeText: { color: colors.onWarning, fontSize: 10, fontWeight: "800" },
  actionLabel: { fontSize: font.sm, fontWeight: "600", color: colors.onSurface, textAlign: "center" },
});
