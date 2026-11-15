import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Customer } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState, formatCurrency } from "@/src/components/ui";
import { openWhatsApp, callPhone, templates } from "@/src/whatsapp";

export default function Outstanding() {
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token) return;
    try {
      const data = await api.outstanding(token);
      setItems(data);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const total = items.reduce((s, c) => s + (c.outstanding || 0), 0);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="outstanding-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Outstanding Dues</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Outstanding</Text>
        <Text style={styles.totalValue}>{formatCurrency(total)}</Text>
        <Text style={styles.totalSub}>{items.length} customers with pending dues</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No dues!" subtitle="All payments are up to date." icon="checkmark-circle-outline" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`due-row-${item.id}`}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/customer/${item.id}`)}>
                <Text style={styles.shop}>{item.shop_name}</Text>
                <Text style={styles.meta}>{item.owner_name || "—"} • {item.area}</Text>
                <Text style={styles.amount}>{formatCurrency(item.outstanding)}</Text>
              </Pressable>
              <View style={styles.actions}>
                <Pressable testID={`due-wa-${item.id}`} style={styles.waBtn}
                  onPress={() => openWhatsApp(item.whatsapp || item.mobile, templates.reminder(item.shop_name, item.outstanding))}>
                  <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                </Pressable>
                <Pressable testID={`due-call-${item.id}`} style={styles.callBtn} onPress={() => callPhone(item.mobile)}>
                  <Ionicons name="call" size={18} color={colors.brandPrimary} />
                </Pressable>
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
  totalCard: { margin: spacing.lg, backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.lg },
  totalLabel: { color: colors.onSurfaceInverse, opacity: 0.8, fontSize: font.sm },
  totalValue: { color: "#FCA5A5", fontSize: 32, fontWeight: "800", marginVertical: spacing.xs },
  totalSub: { color: colors.onSurfaceInverse, opacity: 0.7, fontSize: font.sm },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  shop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  amount: { fontSize: font.lg, fontWeight: "800", color: colors.error, marginTop: spacing.xs },
  actions: { gap: spacing.sm },
  waBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: "#25D36622", alignItems: "center", justifyContent: "center" },
  callBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
});
