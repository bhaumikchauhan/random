import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Item } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState, formatCurrency } from "@/src/components/ui";

const EMPTY = { item_code: "", item_name: "", rate: "", tax_rate: "", mrp: "" };

export default function Items() {
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    try { setItems(await api.listItems(token, q || undefined)); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token, q]));

  const openNew = () => { setEditing(null); setForm(EMPTY); setError(null); setModalOpen(true); };
  const openEdit = (it: Item) => {
    setEditing(it);
    setForm({ item_code: it.item_code, item_name: it.item_name, rate: String(it.rate), tax_rate: String(it.tax_rate), mrp: String(it.mrp) });
    setError(null); setModalOpen(true);
  };

  const save = async () => {
    setError(null);
    if (!form.item_code.trim() || !form.item_name.trim()) { setError("Code and name are required"); return; }
    if (!token) return;
    setSaving(true);
    const body = {
      item_code: form.item_code.trim(), item_name: form.item_name.trim(),
      rate: Number(form.rate) || 0, tax_rate: Number(form.tax_rate) || 0, mrp: Number(form.mrp) || 0, active: true,
    };
    try {
      if (editing) await api.updateItem(token, editing.id, body);
      else await api.createItem(token, body);
      setModalOpen(false);
      load();
    } catch (e: any) { setError(e.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const remove = async (it: Item) => {
    if (!token) return;
    await api.deleteItem(token, it.id);
    setItems(prev => prev.filter(x => x.id !== it.id));
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="items-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Items ({items.length})</Text>
        <Pressable onPress={openNew} testID="item-add-btn" style={styles.iconBtn}>
          <Ionicons name="add" size={26} color={colors.brandPrimary} />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.onSurfaceSecondary} />
        <TextInput testID="items-search" value={q} onChangeText={setQ} placeholder="Search items..." placeholderTextColor={colors.onSurfaceTertiary} style={styles.search} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No items" subtitle="Tap + to add your first product." icon="cube-outline" />}
          renderItem={({ item }) => (
            <Pressable onPress={() => openEdit(item)} testID={`item-row-${item.id}`} style={styles.card}>
              <View style={styles.codeBox}><Text style={styles.codeText}>{item.item_code}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.item_name}</Text>
                <Text style={styles.meta}>Rate {formatCurrency(item.rate)} · Tax {item.tax_rate}% · MRP {formatCurrency(item.mrp)}</Text>
              </View>
              <Pressable testID={`item-del-${item.id}`} onPress={() => remove(item)} hitSlop={8} style={styles.delBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing ? "Edit Item" : "New Item"}</Text>
              <Pressable onPress={() => setModalOpen(false)} testID="item-modal-close"><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <KeyboardAwareScrollView bottomOffset={20} keyboardShouldPersistTaps="handled">
              <Field label="Item Code *" value={form.item_code} onChange={(v: string) => setForm({ ...form, item_code: v })} testID="item-code" />
              <Field label="Item Name *" value={form.item_name} onChange={(v: string) => setForm({ ...form, item_name: v })} testID="item-name" />
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}><Field label="Rate ₹" value={form.rate} onChange={(v: string) => setForm({ ...form, rate: v })} keyboardType="numeric" testID="item-rate" /></View>
                <View style={{ flex: 1 }}><Field label="Tax %" value={form.tax_rate} onChange={(v: string) => setForm({ ...form, tax_rate: v })} keyboardType="numeric" testID="item-tax" /></View>
              </View>
              <Field label="MRP ₹" value={form.mrp} onChange={(v: string) => setForm({ ...form, mrp: v })} keyboardType="numeric" testID="item-mrp" />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable testID="item-save-btn" onPress={save} disabled={saving} style={styles.saveBtn}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>{editing ? "Save Changes" : "Add Item"}</Text>}
              </Pressable>
            </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, keyboardType, testID }: any) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} keyboardType={keyboardType}
        placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  searchWrap: { marginHorizontal: spacing.lg, marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44 },
  search: { flex: 1, color: colors.onSurface, fontSize: font.base },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  codeBox: { backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 64, alignItems: "center" },
  codeText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 11 },
  name: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  delBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600", marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  error: { color: colors.error, fontWeight: "600", marginBottom: spacing.sm },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
