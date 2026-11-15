import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";

import { useAuth } from "@/src/auth";
import { api, Customer, fileUrl } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";

const REASONS = ["Duplicate shop", "Incomplete details", "Not a valid customer", "Wrong area"];

export default function Approvals() {
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  // reject modal state
  const [rejectTarget, setRejectTarget] = useState<Customer | null>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const load = async () => {
    if (!token) return;
    try { setItems(await api.listCustomers(token, { approval: "pending" })); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const approve = async (id: string) => {
    if (!token) return;
    setApproving(id);
    try {
      await api.approveCustomer(token, id);
      setItems(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.warn(e); }
    finally { setApproving(null); }
  };

  const submitReject = async () => {
    if (!token || !rejectTarget) return;
    setRejecting(true);
    try {
      await api.rejectCustomer(token, rejectTarget.id, reason.trim() || "Not specified");
      setItems(prev => prev.filter(c => c.id !== rejectTarget.id));
      setRejectTarget(null);
      setReason("");
    } catch (e) { console.warn(e); }
    finally { setRejecting(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="approvals-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Approvals</Text>
        <View style={styles.countBadge}><Text style={styles.countText}>{items.length}</Text></View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="All clear!" subtitle="No customers waiting for approval." icon="checkmark-done-outline" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`approval-row-${item.id}`}>
              <Pressable style={styles.info} onPress={() => router.push(`/customer/${item.id}`)}>
                {item.shop_photo ? (
                  <Image source={fileUrl(item.shop_photo)!} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}><Text style={styles.thumbText}>{item.shop_name?.[0]?.toUpperCase()}</Text></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.shop} numberOfLines={1}>{item.shop_name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{item.owner_name || "—"}{item.area ? ` • ${item.area}` : ""}</Text>
                  <Text style={styles.by} numberOfLines={1}>Added by {item.salesman_name || "salesman"}</Text>
                </View>
              </Pressable>
              <View style={styles.actions}>
                <Pressable testID={`reject-${item.id}`} onPress={() => { setRejectTarget(item); setReason(""); }} style={styles.rejectBtn}>
                  <Ionicons name="close" size={20} color={colors.error} />
                </Pressable>
                <Pressable testID={`approve-${item.id}`} onPress={() => approve(item.id)} disabled={approving === item.id} style={styles.approveBtn}>
                  {approving === item.id ? <ActivityIndicator size="small" color={colors.onSuccess} /> : <Ionicons name="checkmark" size={22} color={colors.onSuccess} />}
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={!!rejectTarget} transparent animationType="slide" onRequestClose={() => setRejectTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>Reject: {rejectTarget?.shop_name}</Text>
              <Pressable onPress={() => setRejectTarget(null)} testID="reject-close">
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.modalSub}>Add a reason so the salesman knows why. This removes it from the database.</Text>
            <View style={styles.reasonChips}>
              {REASONS.map(r => (
                <Pressable key={r} testID={`reason-${r}`} onPress={() => setReason(r)}
                  style={[styles.reasonChip, reason === r && styles.reasonChipActive]}>
                  <Text style={[styles.reasonChipText, reason === r && styles.reasonChipTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              testID="reject-reason-input"
              value={reason}
              onChangeText={setReason}
              placeholder="Reason for rejection..."
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.reasonInput}
              multiline
            />
            <Pressable testID="reject-submit" onPress={submitReject} disabled={rejecting} style={styles.rejectSubmit}>
              {rejecting ? <ActivityIndicator color={colors.onError} /> : <Text style={styles.rejectSubmitText}>Reject Customer</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  countBadge: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: colors.warning, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, marginRight: spacing.sm },
  countText: { color: colors.onWarning, fontWeight: "800", fontSize: font.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  info: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  thumbEmpty: { backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  thumbText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: font.lg },
  shop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  by: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm },
  rejectBtn: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  approveBtn: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.success, alignItems: "center", justifyContent: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface, flex: 1 },
  modalSub: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  reasonChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  reasonChip: { paddingHorizontal: spacing.md, height: 36, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  reasonChipActive: { borderColor: colors.error, backgroundColor: "#FEE2E2" },
  reasonChipText: { color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: font.sm },
  reasonChipTextActive: { color: colors.error },
  reasonInput: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, minHeight: 60, textAlignVertical: "top", color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  rejectSubmit: { backgroundColor: colors.error, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  rejectSubmitText: { color: colors.onError, fontWeight: "700", fontSize: font.lg },
});
