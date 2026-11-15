import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Dashboard, Customer, AttendanceToday } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { StatCard, formatCurrency, EmptyState } from "@/src/components/ui";
import { openWhatsApp, callPhone, templates } from "@/src/whatsapp";
import { fmtDate, fmtTime, fmtDateTime } from "@/src/utils/datetime";

export default function SalesmanDay() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [attendance, setAttendance] = useState<AttendanceToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const [d, cs, att] = await Promise.all([
        api.dashboard(token),
        api.listCustomers(token),
        api.attendanceToday(token),
      ]);
      setData(d);
      setCustomers(cs);
      setAttendance(att);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const followups = customers.filter(c => c.next_followup && new Date(c.next_followup) <= new Date());

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Hello, {user?.name?.split(" ")[0]}</Text>
          <Text style={styles.title}>My Day</Text>
        </View>
        <View style={styles.trackBadge}>
          <View style={styles.dot} />
          <Text style={styles.trackText}>Tracking on</Text>
        </View>
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
          <Pressable testID="attendance-card" onPress={() => router.push("/attendance")} style={styles.attCard}>
            <View style={[styles.attIcon, { backgroundColor: attendance?.checked_out ? colors.surfaceSecondary : attendance?.checked_in ? "#F0FDF4" : colors.brandTertiary }]}>
              <Ionicons name="finger-print" size={22} color={attendance?.checked_in ? colors.success : colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.attTitle}>
                {attendance?.checked_out ? "Shift complete" : attendance?.checked_in ? "You're checked in" : "Mark your attendance"}
              </Text>
              <Text style={styles.attSub}>
                {attendance?.checked_in
                  ? `In at ${fmtTime(attendance.record!.check_in_time!)}`
                  : "Tap to check in with a selfie"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
          </Pressable>

          <View style={styles.row}>
            <StatCard testID="stat-my-visits" label="Today's Visits" value={String(data?.todays_visits || 0)} icon="clipboard" accent={colors.brandPrimary} />
            <StatCard testID="stat-my-customers" label="My Customers" value={String(data?.total_customers || 0)} icon="storefront" />
          </View>
          <View style={styles.row}>
            <StatCard testID="stat-my-revenue" label="Today's Orders" value={formatCurrency(data?.todays_revenue || 0)} icon="trending-up" />
            <StatCard testID="stat-my-outstanding" label="Dues to Collect" value={formatCurrency(data?.total_outstanding || 0)} icon="cash" accent={colors.error} />
          </View>

          <View style={styles.wrapCard} testID="day-wrapup">
            <Text style={styles.wrapTitle}>Today's Wrap-Up</Text>
            <View style={styles.wrapRow}>
              <View style={styles.wrapItem}>
                <Text style={styles.wrapValue}>{formatCurrency(data?.todays_revenue || 0)}</Text>
                <Text style={styles.wrapLabel}>Total Sales</Text>
              </View>
              <View style={styles.wrapDivider} />
              <View style={styles.wrapItem}>
                <Text style={styles.wrapValue}>{data?.todays_shops || 0}</Text>
                <Text style={styles.wrapLabel}>Shops Covered</Text>
              </View>
              <View style={styles.wrapDivider} />
              <View style={styles.wrapItem}>
                <Text style={styles.wrapValue}>{data?.todays_visits || 0}</Text>
                <Text style={styles.wrapLabel}>Bills</Text>
              </View>
            </View>
          </View>

          <View style={styles.ctaRow}>
            <Pressable testID="beat-plan-cta" onPress={() => router.push("/beat-plan")} style={styles.beatBtn}>
              <Ionicons name="navigate" size={20} color={colors.brandPrimary} />
              <Text style={styles.beatText}>Beat Plan</Text>
            </Pressable>
            <Pressable testID="new-bill-cta" onPress={() => router.push("/order/new")} style={styles.logVisitBtn}>
              <Ionicons name="add-circle" size={22} color={colors.onBrandPrimary} />
              <Text style={styles.logVisitText}>New Bill</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Follow-ups Due</Text>
          {followups.length === 0 ? (
            <View style={styles.card}><EmptyState title="All caught up!" subtitle="No follow-ups pending today." icon="checkmark-circle-outline" /></View>
          ) : (
            followups.map(c => (
              <View key={c.id} style={styles.followCard}>
                <Pressable style={{ flex: 1 }} onPress={() => router.push(`/customer/${c.id}`)}>
                  <Text style={styles.followShop}>{c.shop_name}</Text>
                  <Text style={styles.followMeta}>{c.area} • Follow up {fmtDate(c.next_followup!)}</Text>
                </Pressable>
                <Pressable testID={`wa-${c.id}`} onPress={() => openWhatsApp(c.whatsapp || c.mobile, templates.followup(c.shop_name))} style={styles.waBtn}>
                  <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                </Pressable>
                <Pressable testID={`call-${c.id}`} onPress={() => callPhone(c.mobile)} style={styles.callBtn}>
                  <Ionicons name="call" size={18} color={colors.brandPrimary} />
                </Pressable>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>Recent Bills</Text>
          {(!data?.recent_visits || data.recent_visits.length === 0) ? (
            <View style={styles.card}><EmptyState title="No bills yet" subtitle="Start creating bills today." icon="receipt-outline" /></View>
          ) : (
            data.recent_visits.slice(0, 5).map((v: any) => (
              <View key={v.id} style={styles.visitCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.visitShop}>{v.customer_name}</Text>
                  <Text style={styles.visitMeta}>{fmtDateTime(v.order_date || v.visit_date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}{v.total_amount ? ` • ${formatCurrency(v.total_amount)}` : ""}</Text>
                </View>
                <View style={styles.pill}><Text style={styles.pillText}>{v.outcome || v.visit_result || "Order"}</Text></View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.divider },
  hello: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  trackBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  trackText: { color: colors.onBrandTertiary, fontSize: font.sm, fontWeight: "700" },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  attCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  attIcon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  attTitle: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  attSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  row: { flexDirection: "row", gap: spacing.md },
  wrapCard: { backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.xs },
  wrapTitle: { color: colors.onSurfaceInverse, opacity: 0.85, fontSize: font.sm, fontWeight: "700", marginBottom: spacing.md },
  wrapRow: { flexDirection: "row", alignItems: "center" },
  wrapItem: { flex: 1, alignItems: "center" },
  wrapValue: { color: colors.onSurfaceInverse, fontSize: font.lg, fontWeight: "800" },
  wrapLabel: { color: colors.onSurfaceInverse, opacity: 0.7, fontSize: 11, marginTop: 2 },
  wrapDivider: { width: 1, height: 32, backgroundColor: colors.onSurfaceInverse, opacity: 0.2 },
  logVisitBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md },
  logVisitText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
  ctaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  beatBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md },
  beatText: { color: colors.brandPrimary, fontWeight: "700", fontSize: font.lg },
  billBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  billText: { color: colors.brandPrimary, fontWeight: "700", fontSize: font.lg },
  sectionTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  followCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  followShop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  followMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  waBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: "#25D36622", alignItems: "center", justifyContent: "center" },
  callBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  visitCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  visitShop: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  visitMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  pill: { backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  pillText: { color: colors.onBrandTertiary, fontSize: font.sm, fontWeight: "700" },
});
