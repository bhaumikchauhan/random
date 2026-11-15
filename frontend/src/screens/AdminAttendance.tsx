import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, AttendanceListRow, AttendanceSummaryRow, fileUrl, downloadAttendanceSheet } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStr() { return new Date().toISOString().slice(0, 7); }

export default function AdminAttendance() {
  const { token } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"daily" | "monthly">("daily");
  const [daily, setDaily] = useState<AttendanceListRow[]>([]);
  const [monthly, setMonthly] = useState<AttendanceSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const doExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const r = await downloadAttendanceSheet(token, monthStr());
      setToast(r.ok ? "Attendance sheet ready" : r.message);
      setTimeout(() => setToast(null), 2500);
    } catch (e: any) {
      setToast("Export failed");
      setTimeout(() => setToast(null), 2500);
    } finally { setExporting(false); }
  };

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (tab === "daily") {
        const res = await api.attendanceList(token, { date: todayStr() });
        setDaily(res.rows);
      } else {
        const res = await api.attendanceSummary(token, monthStr());
        setMonthly(res.rows);
      }
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token, tab]));

  const presentCount = daily.filter(r => r.present).length;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="admin-att-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Attendance</Text>
        <Pressable onPress={doExport} disabled={exporting} testID="attendance-export-btn" style={styles.iconBtn}>
          {exporting ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="download-outline" size={22} color={colors.brandPrimary} />}
        </Pressable>
      </View>

      {toast && (
        <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>
      )}

      <View style={styles.segment}>
        <Pressable testID="att-tab-daily" onPress={() => setTab("daily")} style={[styles.segItem, tab === "daily" && styles.segItemActive]}>
          <Text style={[styles.segText, tab === "daily" && styles.segTextActive]}>Today</Text>
        </Pressable>
        <Pressable testID="att-tab-monthly" onPress={() => setTab("monthly")} style={[styles.segItem, tab === "monthly" && styles.segItemActive]}>
          <Text style={[styles.segText, tab === "monthly" && styles.segTextActive]}>This Month</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : tab === "daily" ? (
        <FlatList
          data={daily}
          keyExtractor={(r) => r.salesman_id}
          ListHeaderComponent={
            <View style={styles.summaryBar}>
              <Text style={styles.summaryText}>{presentCount} of {daily.length} present today</Text>
            </View>
          }
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No salesmen" icon="people-outline" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`att-row-${item.salesman_id}`}>
              {item.record?.check_in_photo ? (
                <Image source={fileUrl(item.record.check_in_photo)!} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.avatarText}>{item.salesman_name?.[0]?.toUpperCase()}</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.salesman_name}</Text>
                <Text style={styles.area}>{item.area || "—"}</Text>
                {item.present && (
                  <Text style={styles.times}>In {fmtTime(item.record?.check_in_time)} · Out {fmtTime(item.record?.check_out_time)}
                    {item.record?.total_hours != null ? `  ·  ${item.record.total_hours}h` : ""}</Text>
                )}
                {item.present && item.record?.check_in_flagged && (
                  <View style={styles.farBadge} testID={`att-flag-${item.salesman_id}`}>
                    <Ionicons name="warning" size={11} color={colors.onWarning} />
                    <Text style={styles.farText}>{item.record?.check_in_distance_km} km from area</Text>
                  </View>
                )}
              </View>
              <View style={[styles.badge, { backgroundColor: item.present ? "#F0FDF4" : colors.surfaceSecondary }]}>
                <View style={[styles.dot, { backgroundColor: item.present ? colors.success : colors.borderStrong }]} />
                <Text style={[styles.badgeText, { color: item.present ? colors.success : colors.onSurfaceSecondary }]}>
                  {item.present ? "Present" : "Absent"}
                </Text>
              </View>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={monthly}
          keyExtractor={(r) => r.salesman_id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No data" icon="calendar-outline" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`att-month-${item.salesman_id}`}>
              <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.avatarText}>{item.salesman_name?.[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.salesman_name}</Text>
                <Text style={styles.area}>{item.area || "—"}</Text>
              </View>
              <View style={styles.monthStats}>
                <View style={styles.statBox}><Text style={styles.statValue}>{item.days_present}</Text><Text style={styles.statLabel}>days</Text></View>
                <View style={styles.statBox}><Text style={[styles.statValue, { color: colors.brandPrimary }]}>{item.total_hours}</Text><Text style={styles.statLabel}>hours</Text></View>
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
  summaryBar: { paddingBottom: spacing.sm },
  summaryText: { fontSize: font.base, fontWeight: "700", color: colors.onSurfaceSecondary },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 48, height: 48, borderRadius: radius.pill },
  avatarEmpty: { backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: font.lg },
  name: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  area: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  times: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  farBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.warning, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, marginTop: spacing.xs },
  farText: { color: colors.onWarning, fontSize: 10, fontWeight: "700" },
  toast: { backgroundColor: colors.surfaceInverse, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  toastText: { color: colors.onSurfaceInverse, textAlign: "center", fontWeight: "600" },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontWeight: "700", fontSize: font.sm },
  monthStats: { flexDirection: "row", gap: spacing.md },
  statBox: { alignItems: "center", minWidth: 44 },
  statValue: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },
  statLabel: { fontSize: 10, color: colors.onSurfaceSecondary },
});
