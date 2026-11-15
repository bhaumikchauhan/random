import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, OrderDetailed, Customer } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Chip, EmptyState } from "@/src/components/ui";
import { fmtDate, fmtTime } from "@/src/utils/datetime";
import { openWhatsApp, callPhone, templates } from "@/src/whatsapp";

function isToday(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function NoOrder() {
  const { token } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderDetailed[]>([]);
  const [contacts, setContacts] = useState<Record<string, Customer>>({});
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"Today" | "All">("Today");

  const load = async () => {
    if (!token) return;
    try {
      const [os, cs] = await Promise.all([api.listOrders(token), api.listCustomers(token)]);
      setOrders(os);
      const map: Record<string, Customer> = {};
      cs.forEach(c => { map[c.id] = c; });
      setContacts(map);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, [token]));

  const rows = useMemo(() => {
    let r = orders.filter(o => (o.outcome || "Order") === "No Order");
    if (range === "Today") r = r.filter(o => isToday(o.order_date));
    return r;
  }, [orders, range]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="noorder-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>No-Order Shops</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.chipRow}>
        {(["Today", "All"] as const).map(r => (
          <Chip key={r} label={r} active={range === r} onPress={() => setRange(r)} testID={`noorder-range-${r}`} />
        ))}
        <View style={{ flex: 1 }} />
        <View style={styles.countPill}><Text style={styles.countText}>{rows.length}</Text></View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No 'No-Order' visits" subtitle={range === "Today" ? "Nothing marked No Order today." : "No records found."} icon="checkmark-circle-outline" />}
          renderItem={({ item }) => {
            const c = contacts[item.customer_id];
            return (
              <Pressable style={styles.card} testID={`noorder-row-${item.id}`} onPress={() => router.push(`/order/${item.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shop}>{item.customer_name}</Text>
                  <Text style={styles.meta}>{item.salesman_name} • {fmtDate(item.order_date, { month: "short", day: "numeric" })} {fmtTime(item.order_date)}</Text>
                  {!!item.no_order_reason && (
                    <View style={styles.reasonPill}><Text style={styles.reasonText}>{item.no_order_reason}</Text></View>
                  )}
                  {!!(item.no_order_note || item.remarks) && <Text style={styles.remarks} numberOfLines={2}>“{item.no_order_note || item.remarks}”</Text>}
                </View>
                {c && (
                  <View style={styles.actions}>
                    <Pressable testID={`noorder-wa-${item.id}`} onPress={() => openWhatsApp(c.whatsapp || c.mobile, templates.followup(c.shop_name))} style={styles.waBtn}>
                      <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                    </Pressable>
                    <Pressable testID={`noorder-call-${item.id}`} onPress={() => callPhone(c.mobile)} style={styles.callBtn} disabled={!c.mobile}>
                      <Ionicons name="call" size={16} color={c.mobile ? colors.brandPrimary : colors.onSurfaceTertiary} />
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  chipRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  countPill: { backgroundColor: colors.error + "22", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  countText: { color: colors.error, fontWeight: "800", fontSize: font.base },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  shop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  remarks: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: spacing.xs, fontStyle: "italic" },
  reasonPill: { alignSelf: "flex-start", backgroundColor: colors.error + "18", paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill, marginTop: spacing.xs },
  reasonText: { color: colors.error, fontWeight: "700", fontSize: font.sm },
  actions: { gap: spacing.xs },
  waBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: "#25D36622", alignItems: "center", justifyContent: "center" },
  callBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
});
