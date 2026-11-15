import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, OrderDetailed } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { formatCurrency } from "@/src/components/ui";
import { confirmDialog } from "@/src/utils/dialog";
import { fmtDateTime } from "@/src/utils/datetime";

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: colors.warning },
  submitted: { label: "Submitted", color: colors.success },
};

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin";
  const [o, setO] = useState<OrderDetailed | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!token || !id) return;
    try { setO(await api.getOrder(token, id)); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token, id]));

  const submit = async () => {
    if (!o || !token) return;
    const ok = await confirmDialog("Submit to Admin", "Once submitted you cannot edit this bill. Continue?", { confirmText: "Submit" });
    if (!ok) return;
    setBusy(true);
    try { setO(await api.submitOrder(token, o.id)); }
    catch (e: any) { Alert.alert("Error", e.message || "Failed to submit"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!o || !token) return;
    const ok = await confirmDialog("Delete Bill", "This will permanently delete the bill. Continue?", { confirmText: "Delete", destructive: true });
    if (!ok) return;
    setBusy(true);
    try { await api.deleteOrder(token, o.id); router.back(); }
    catch (e: any) { Alert.alert("Error", e.message || "Failed to delete"); setBusy(false); }
  };

  if (loading || !o) {
    return <SafeAreaView style={styles.root}><View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>;
  }

  const meta = STATUS_META[o.status || "draft"] || STATUS_META.draft;
  const isOwner = o.salesman_id === user?.id;
  const isDraft = (o.status || "draft") === "draft";
  const canEdit = isAdmin || (isOwner && isDraft);
  const canSubmit = isDraft && (isAdmin || isOwner);
  const canDelete = isAdmin || (isOwner && isDraft);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="order-detail-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{o.order_number || "Bill"}</Text>
        {canDelete ? (
          <Pressable onPress={remove} testID="order-delete" style={styles.iconBtn}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        <View style={styles.topCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.party}>{o.customer_name}</Text>
            <Text style={styles.sub}>{fmtDateTime(o.order_date, { dateStyle: "medium", timeStyle: "short" })}</Text>
            <Text style={styles.sub}>By {o.salesman_name}</Text>
          </View>
          <View testID="order-detail-status" style={[styles.statusPill, { backgroundColor: meta.color + "22" }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        <View style={styles.tableCard}>
          <View style={styles.tHead}>
            <Text style={[styles.th, { flex: 2 }]}>Item</Text>
            <Text style={styles.th}>Qty</Text>
            <Text style={styles.th}>Rate</Text>
            <Text style={[styles.th, { textAlign: "right" }]}>Net</Text>
          </View>
          {o.lines.map((l, idx) => (
            <View key={idx} style={styles.tRow} testID={`order-line-view-${idx}`}>
              <View style={{ flex: 2 }}>
                <Text style={styles.itemName} numberOfLines={1}>{l.item_name}</Text>
                <Text style={styles.itemSub}>{l.item_code} · Tax {l.tax_rate}%{l.discount ? ` · Disc ${l.discount}%` : ""}{l.free_qty ? ` · Free ${l.free_qty}` : ""}</Text>
              </View>
              <Text style={styles.td}>{l.qty}</Text>
              <Text style={styles.td}>{formatCurrency(l.rate)}</Text>
              <Text style={[styles.td, { textAlign: "right", fontWeight: "700" }]}>{formatCurrency(l.net)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(o.total_amount)}</Text>
          </View>
        </View>

        {o.outcome === "No Order" && !!o.no_order_reason && (
          <View style={styles.remarksCard}>
            <Text style={styles.remarksLabel}>No-Order Reason</Text>
            <Text style={styles.remarksText}>{o.no_order_reason}{o.no_order_note ? ` — ${o.no_order_note}` : ""}</Text>
          </View>
        )}

        {!!o.remarks && (
          <View style={styles.remarksCard}>
            <Text style={styles.remarksLabel}>Remarks</Text>
            <Text style={styles.remarksText}>{o.remarks}</Text>
          </View>
        )}

        {!isDraft && isOwner && !isAdmin && (
          <View style={styles.lockedCard}>
            <Ionicons name="lock-closed" size={16} color={colors.onSurfaceSecondary} />
            <Text style={styles.lockedText}>This bill was submitted and is locked. Ask an admin to make changes.</Text>
          </View>
        )}
      </ScrollView>

      {(canEdit || canSubmit) && (
        <SafeAreaView edges={["bottom"]} style={styles.footer}>
          {canEdit && (
            <Pressable testID="order-edit" onPress={() => router.push({ pathname: "/order/new", params: { order_id: o.id } })}
              style={[styles.actionBtn, styles.editBtn]} disabled={busy}>
              <Ionicons name="create-outline" size={18} color={colors.brandPrimary} />
              <Text style={[styles.actionText, { color: colors.brandPrimary }]}>Edit</Text>
            </Pressable>
          )}
          {canSubmit && (
            <Pressable testID="order-submit-admin" onPress={submit} style={[styles.actionBtn, styles.submitBtn]} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <>
                  <Ionicons name="checkmark-done" size={18} color={colors.onBrandPrimary} />
                  <Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>Submit to Admin</Text>
                </>
              )}
            </Pressable>
          )}
        </SafeAreaView>
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
  topCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  party: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, minWidth: 80, alignItems: "center" },
  statusText: { fontWeight: "800", fontSize: font.base },
  tableCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  tHead: { flexDirection: "row", paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  th: { flex: 1, fontSize: font.sm, fontWeight: "700", color: colors.onSurfaceSecondary },
  tRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm },
  itemName: { fontSize: font.base, fontWeight: "600", color: colors.onSurface },
  itemSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  td: { flex: 1, fontSize: font.sm, color: colors.onSurface },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: spacing.md },
  totalLabel: { fontSize: font.lg, fontWeight: "700", color: colors.onSurfaceSecondary },
  totalValue: { fontSize: font.xxl, fontWeight: "800", color: colors.brandPrimary },
  remarksCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  remarksLabel: { fontSize: font.sm, fontWeight: "700", color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  remarksText: { fontSize: font.base, color: colors.onSurface, lineHeight: 20 },
  lockedCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  lockedText: { flex: 1, fontSize: font.sm, color: colors.onSurfaceSecondary },
  footer: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.md },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, paddingVertical: spacing.md },
  editBtn: { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary },
  submitBtn: { backgroundColor: colors.brandPrimary },
  actionText: { fontWeight: "700", fontSize: font.base },
});
