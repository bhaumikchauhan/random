import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, Alert, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, OrderDetailed, downloadBillsSheet } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Chip, EmptyState, formatCurrency } from "@/src/components/ui";
import { fmtDate } from "@/src/utils/datetime";

const FILTERS = ["All", "Draft", "Submitted"];
const EXPORT_RANGES = ["All time", "Today", "Last 7 days", "This month", "Custom"] as const;
type ExportRange = typeof EXPORT_RANGES[number];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const validYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: colors.warning },
  submitted: { label: "Submitted", color: colors.success },
};

export default function Orders() {
  const { token, user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState<OrderDetailed[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [range, setRange] = useState<ExportRange>("All time");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");

  const load = async () => {
    if (!token) return;
    try { setItems(await api.listOrders(token)); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const filtered = filter === "All" ? items : items.filter(o => (o.status || "draft") === filter.toLowerCase());
  const totals = useMemo(() => {
    const submitted = items.filter(o => o.status === "submitted");
    return { count: items.length, submittedCount: submitted.length, submittedValue: submitted.reduce((s, o) => s + o.total_amount, 0) };
  }, [items]);

  const doExport = async () => {
    if (!token) return;
    let from: string | undefined;
    let to: string | undefined;
    const now = new Date();
    if (range === "Today") { from = ymd(now); to = ymd(now); }
    else if (range === "Last 7 days") { const s = new Date(now); s.setDate(s.getDate() - 6); from = ymd(s); to = ymd(now); }
    else if (range === "This month") { from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); to = ymd(now); }
    else if (range === "Custom") {
      if (fromText && !validYmd(fromText)) { Alert.alert("Export", "From date must be YYYY-MM-DD"); return; }
      if (toText && !validYmd(toText)) { Alert.alert("Export", "To date must be YYYY-MM-DD"); return; }
      from = fromText.trim() || undefined; to = toText.trim() || undefined;
    }
    setExporting(true);
    try {
      const r = await downloadBillsSheet(token, from, to);
      if (!r.ok) Alert.alert("Export", r.message);
      else setExportOpen(false);
    } finally { setExporting(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="orders-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Bills</Text>
        {isAdmin ? (
          <Pressable onPress={() => setExportOpen(true)} testID="bills-export-btn" style={styles.iconBtn}>
            <Ionicons name="download-outline" size={22} color={colors.brandPrimary} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Bills</Text>
          <Text style={styles.summaryValue}>{totals.count}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.brandTertiary }]}>
          <Text style={[styles.summaryLabel, { color: colors.onBrandTertiary }]}>Submitted Value</Text>
          <Text style={[styles.summaryValue, { color: colors.brandPrimary }]}>{formatCurrency(totals.submittedValue)}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipContent}>
        {FILTERS.map(s => (
          <Chip key={s} label={s} active={filter === s} onPress={() => setFilter(s)} testID={`order-filter-${s}`} />
        ))}
      </ScrollView>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No bills yet" subtitle="Tap + to create a new bill." icon="receipt-outline" />}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status || "draft"] || STATUS_META.draft;
            return (
              <Pressable style={styles.card} testID={`order-row-${item.id}`} onPress={() => router.push(`/order/${item.id}`)}>
                <View style={{ flex: 1 }}>
                  {!!item.order_number && <Text style={styles.orderNo}>{item.order_number}</Text>}
                  <Text style={styles.shop}>{item.customer_name}</Text>
                  <Text style={styles.meta}>{item.salesman_name} • {fmtDate(item.order_date, { month: "short", day: "numeric" })}{item.lines?.length ? ` • ${item.lines.length} items` : ""}</Text>
                  <Text style={styles.amount}>{formatCurrency(item.total_amount)}</Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: meta.color + "22" }]}>
                  <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
      <Pressable testID="orders-fab" onPress={() => router.push("/order/new")} style={styles.fab}>
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={exportOpen} transparent animationType="slide" onRequestClose={() => setExportOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.exportCard}>
            <View style={styles.exportHeader}>
              <Text style={styles.exportTitle}>Export Bills</Text>
              <Pressable onPress={() => setExportOpen(false)} testID="export-close"><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={styles.exportHint}>Only submitted bills are exported.</Text>
            <View style={styles.rangeWrap}>
              {EXPORT_RANGES.map(r => (
                <Chip key={r} label={r} active={range === r} onPress={() => setRange(r)} testID={`export-range-${r}`} />
              ))}
            </View>
            {range === "Custom" && (
              <View style={styles.customRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.customLabel}>From (YYYY-MM-DD)</Text>
                  <TextInput testID="export-from" value={fromText} onChangeText={setFromText} placeholder="2026-06-01" placeholderTextColor={colors.onSurfaceTertiary} style={styles.customInput} autoCapitalize="none" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.customLabel}>To (YYYY-MM-DD)</Text>
                  <TextInput testID="export-to" value={toText} onChangeText={setToText} placeholder="2026-06-30" placeholderTextColor={colors.onSurfaceTertiary} style={styles.customInput} autoCapitalize="none" />
                </View>
              </View>
            )}
            <Pressable testID="export-confirm" onPress={doExport} disabled={exporting} style={styles.exportBtn}>
              {exporting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.exportBtnText}>Download Excel</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  summaryRow: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.sm },
  summaryCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  summaryLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  summaryValue: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface, marginTop: spacing.xs },
  chipRow: { flexGrow: 0, maxHeight: 56, backgroundColor: colors.surfaceSecondary },
  chipContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  shop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  orderNo: { fontSize: font.sm, fontWeight: "800", color: colors.brandPrimary, marginBottom: 2 },
  fab: { position: "absolute", right: spacing.lg, bottom: spacing.xl, width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  amount: { fontSize: font.lg, fontWeight: "800", color: colors.brandPrimary, marginTop: spacing.xs },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, minWidth: 90, alignItems: "center" },
  statusText: { fontWeight: "700", fontSize: font.sm },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  exportCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  exportHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  exportTitle: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },
  exportHint: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  rangeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  customRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  customLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600", marginBottom: spacing.xs },
  customInput: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  exportBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  exportBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
