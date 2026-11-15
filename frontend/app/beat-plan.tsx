import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, BeatStop, Customer, Route } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState, formatCurrency, Chip } from "@/src/components/ui";
import { openWhatsApp, callPhone, templates } from "@/src/whatsapp";

function today() { return new Date().toISOString().slice(0, 10); }

export default function BeatPlan() {
  const { token } = useAuth();
  const router = useRouter();
  const [stops, setStops] = useState<BeatStop[]>([]);
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeFilter, setRouteFilter] = useState<string>("All");
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!token) return;
    try {
      const plan = await api.getBeatPlan(token, { date: today() });
      setStops(plan.stops);
      setAuto(plan.auto);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    api.listRoutes(token).then(setRoutes).catch(() => {});
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const persist = async (newStops: BeatStop[]) => {
    if (!token) return;
    setStops(newStops);
    setSaving(true);
    try {
      const plan = await api.setBeatPlan(token, { date: today(), customer_ids: newStops.map(s => s.customer_id) });
      setStops(plan.stops);
      setAuto(false);
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= stops.length) return;
    const copy = [...stops];
    [copy[index], copy[j]] = [copy[j], copy[index]];
    persist(copy);
  };

  const remove = (cid: string) => persist(stops.filter(s => s.customer_id !== cid));

  const openPicker = async () => {
    if (!token) return;
    if (allCustomers.length === 0) {
      try { setAllCustomers(await api.listCustomers(token)); } catch {}
    }
    setPickerOpen(true);
  };

  const addStop = (c: Customer) => {
    if (stops.some(s => s.customer_id === c.id)) return;
    const newStop: BeatStop = {
      customer_id: c.id, shop_name: c.shop_name, owner_name: c.owner_name, area: c.area,
      mobile: c.mobile, whatsapp: c.whatsapp, gps_lat: c.gps_lat, gps_lng: c.gps_lng,
      outstanding: c.outstanding || 0, order: stops.length + 1, visited: false,
    };
    persist([...stops, newStop]);
  };

  const navigate = (s: BeatStop) => {
    if (s.gps_lat && s.gps_lng) Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${s.gps_lat},${s.gps_lng}`);
  };

  const done = stops.filter(s => s.visited).length;
  const routeCustomers = allCustomers.filter(c => routeFilter === "All" || c.route === routeFilter);
  const allRouteAdded = routeCustomers.length > 0 && routeCustomers.every(c => stops.some(s => s.customer_id === c.id));
  const available = allCustomers.filter(c =>
    !stops.some(s => s.customer_id === c.id) &&
    (routeFilter === "All" || c.route === routeFilter) &&
    (!search || c.shop_name.toLowerCase().includes(search.toLowerCase())));

  const toBeatStop = (c: Customer): BeatStop => ({
    customer_id: c.id, shop_name: c.shop_name, owner_name: c.owner_name, area: c.area,
    mobile: c.mobile, whatsapp: c.whatsapp, gps_lat: c.gps_lat, gps_lng: c.gps_lng,
    outstanding: c.outstanding || 0, order: 0, visited: false,
  });

  const toggleSelectAll = () => {
    const routeIds = new Set(routeCustomers.map(c => c.id));
    if (allRouteAdded) {
      persist(stops.filter(s => !routeIds.has(s.customer_id)));
    } else {
      const missing = routeCustomers.filter(c => !stops.some(s => s.customer_id === c.id));
      persist([...stops, ...missing.map(toBeatStop)]);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="beat-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Today's Beat</Text>
        <Pressable onPress={openPicker} testID="beat-add" style={styles.iconBtn}>
          <Ionicons name="add" size={24} color={colors.brandPrimary} />
        </Pressable>
      </View>

      <View style={styles.progressCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.progressLabel}>Route Progress</Text>
          <Text style={styles.progressValue}>{done} / {stops.length} shops visited</Text>
        </View>
        <View style={styles.progressCircle}>
          <Text style={styles.progressPct}>{stops.length ? Math.round((done / stops.length) * 100) : 0}%</Text>
        </View>
      </View>

      {auto && stops.length > 0 && (
        <Text style={styles.autoNote}>✨ Auto-suggested from preferred order days & due follow-ups. Reorder or edit to make it yours.</Text>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={stops}
          keyExtractor={(s) => s.customer_id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={
            <EmptyState title="No stops planned" subtitle="Tap + to add shops to today's route." icon="navigate-outline" />
          }
          renderItem={({ item, index }) => (
            <View style={[styles.stopCard, item.visited && styles.stopCardDone]} testID={`beat-stop-${item.customer_id}`}>
              <View style={[styles.seq, item.visited && { backgroundColor: colors.success }]}>
                {item.visited ? <Ionicons name="checkmark" size={16} color={colors.onSuccess} /> : <Text style={styles.seqText}>{index + 1}</Text>}
              </View>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/customer/${item.customer_id}`)}>
                <Text style={[styles.shop, item.visited && styles.shopDone]}>{item.shop_name}</Text>
                <Text style={styles.meta}>{item.area || "—"}{item.outstanding > 0 ? ` • Due ${formatCurrency(item.outstanding)}` : ""}</Text>
              </Pressable>
              <View style={styles.actions}>
                <Pressable testID={`beat-wa-${item.customer_id}`} onPress={() => openWhatsApp(item.whatsapp || item.mobile, templates.order(item.shop_name))} style={styles.miniBtn}>
                  <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                </Pressable>
                <Pressable testID={`beat-nav-${item.customer_id}`} onPress={() => navigate(item)} style={styles.miniBtn} disabled={!item.gps_lat}>
                  <Ionicons name="navigate" size={16} color={item.gps_lat ? colors.brandPrimary : colors.onSurfaceTertiary} />
                </Pressable>
              </View>
              <View style={styles.reorder}>
                <Pressable testID={`beat-up-${item.customer_id}`} onPress={() => move(index, -1)} disabled={index === 0}>
                  <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.onSurfaceTertiary : colors.onSurfaceSecondary} />
                </Pressable>
                <Pressable testID={`beat-remove-${item.customer_id}`} onPress={() => remove(item.customer_id)}>
                  <Ionicons name="close" size={16} color={colors.error} />
                </Pressable>
                <Pressable testID={`beat-down-${item.customer_id}`} onPress={() => move(index, 1)} disabled={index === stops.length - 1}>
                  <Ionicons name="chevron-down" size={18} color={index === stops.length - 1 ? colors.onSurfaceTertiary : colors.onSurfaceSecondary} />
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      {stops.length > 0 && (
        <Pressable testID="beat-new-bill" onPress={() => router.push("/order/new")} style={styles.logBtn}>
          <Ionicons name="receipt" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.logBtnText}>New Bill</Text>
        </Pressable>
      )}

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Shops</Text>
              <Pressable onPress={() => { setPickerOpen(false); setSearch(""); }} testID="beat-picker-close">
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>
            {routes.length > 0 && (
              <View style={styles.routeChips}>
                <Chip label="All Routes" active={routeFilter === "All"} onPress={() => setRouteFilter("All")} testID="beat-route-All" />
                {routes.map(r => (
                  <Chip key={r.id} label={r.name} active={routeFilter === r.name} onPress={() => setRouteFilter(r.name)} testID={`beat-route-${r.name}`} />
                ))}
              </View>
            )}
            {routeCustomers.length > 0 && (
              <Pressable testID="beat-select-all" onPress={toggleSelectAll} style={styles.selectAllRow}>
                <Ionicons name={allRouteAdded ? "checkbox" : "square-outline"} size={22} color={colors.brandPrimary} />
                <Text style={styles.selectAllText}>
                  {allRouteAdded ? "Remove all" : "Select all"} {routeFilter === "All" ? "shops" : `in ${routeFilter}`} ({routeCustomers.length})
                </Text>
              </Pressable>
            )}
            <TextInput
              testID="beat-picker-search"
              value={search} onChangeText={setSearch}
              placeholder="Search shops..." placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.modalSearch}
            />
            <FlatList
              data={available}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              ListEmptyComponent={<Text style={styles.emptyPicker}>{routeFilter === "All" ? "No more shops to add." : "No shops in this route."}</Text>}
              renderItem={({ item }) => (
                <Pressable testID={`beat-pick-${item.id}`} onPress={() => addStop(item)} style={styles.pickRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickShop}>{item.shop_name}</Text>
                    <Text style={styles.pickArea}>{item.route || item.area || "—"}</Text>
                  </View>
                  <Ionicons name="add-circle" size={22} color={colors.brandPrimary} />
                </Pressable>
              )}
            />
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
  progressCard: { flexDirection: "row", alignItems: "center", margin: spacing.lg, marginBottom: spacing.sm, backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.lg },
  progressLabel: { color: colors.onSurfaceInverse, opacity: 0.8, fontSize: font.sm },
  progressValue: { color: colors.onSurfaceInverse, fontSize: font.xl, fontWeight: "800", marginTop: spacing.xs },
  progressCircle: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  progressPct: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.base },
  autoNote: { fontSize: font.sm, color: colors.onBrandTertiary, backgroundColor: colors.brandTertiary, marginHorizontal: spacing.lg, padding: spacing.md, borderRadius: radius.sm, marginBottom: spacing.sm },
  stopCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  stopCardDone: { backgroundColor: "#F0FDF4", borderColor: colors.success + "44" },
  seq: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  seqText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.base },
  shop: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  shopDone: { textDecorationLine: "line-through", color: colors.onSurfaceSecondary },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  actions: { gap: spacing.xs },
  miniBtn: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  reorder: { alignItems: "center", gap: 2 },
  logBtn: { position: "absolute", bottom: spacing.lg, left: spacing.lg, right: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md },
  logBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "80%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  modalSearch: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.md, color: colors.onSurface },
  routeChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  selectAllRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  selectAllText: { fontSize: font.base, fontWeight: "700", color: colors.brandPrimary },
  pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickShop: { fontSize: font.base, fontWeight: "600", color: colors.onSurface },
  pickArea: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  emptyPicker: { textAlign: "center", color: colors.onSurfaceSecondary, padding: spacing.xl },
});
