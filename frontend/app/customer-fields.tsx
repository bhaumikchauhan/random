import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, Modal, Platform, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, CustomField } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";
import { confirmDialog } from "@/src/utils/dialog";

const TYPES: { key: "text" | "number" | "dropdown" | "multiselect" | "checkbox"; label: string; icon: any }[] = [
  { key: "text", label: "Text", icon: "text" },
  { key: "number", label: "Number", icon: "calculator" },
  { key: "dropdown", label: "Dropdown", icon: "list" },
  { key: "multiselect", label: "Multi-select", icon: "checkbox-outline" },
  { key: "checkbox", label: "Checkbox", icon: "toggle" },
];

export default function CustomerFields() {
  const { token } = useAuth();
  const router = useRouter();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"text" | "number" | "dropdown" | "multiselect" | "checkbox">("text");
  const [optionsText, setOptionsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    try { setFields(await api.listCustomerFields(token)); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const openNew = () => { setLabel(""); setType("text"); setOptionsText(""); setError(null); setModalOpen(true); };

  const save = async () => {
    setError(null);
    if (!label.trim()) { setError("Field name is required"); return; }
    const options = optionsText.split(",").map(o => o.trim()).filter(Boolean);
    if ((type === "dropdown" || type === "multiselect") && options.length === 0) { setError("Add at least one option"); return; }
    if (!token) return;
    setSaving(true);
    try {
      await api.createCustomerField(token, { label: label.trim(), type, options });
      setModalOpen(false);
      await load();
    } catch (e: any) { setError(e.message || "Could not create field"); }
    finally { setSaving(false); }
  };

  const remove = async (f: CustomField) => {
    const ok = await confirmDialog("Delete Field", `Delete "${f.label}"? Existing customer data for this field stays but the field is removed from the form.`, { confirmText: "Delete", destructive: true });
    if (!ok || !token) return;
    try { await api.deleteCustomerField(token, f.id); setFields(prev => prev.filter(x => x.id !== f.id)); }
    catch (e) { console.warn(e); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="cf-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Custom Fields ({fields.length})</Text>
        <Pressable onPress={openNew} testID="cf-add-btn" style={styles.iconBtn}>
          <Ionicons name="add" size={26} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={fields}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ListHeaderComponent={<Text style={styles.hint}>These fields appear on the Add / Edit Customer screen for everyone.</Text>}
          ListEmptyComponent={<EmptyState title="No custom fields" subtitle="Tap + to create your own customer fields." icon="construct-outline" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`cf-row-${item.id}`}>
              <View style={styles.typeBadge}>
                <Ionicons name={TYPES.find(t => t.key === item.type)?.icon || "text"} size={16} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>{item.label}</Text>
                <Text style={styles.fieldMeta}>{item.type}{item.type === "dropdown" && item.options.length ? ` · ${item.options.join(", ")}` : ""}</Text>
              </View>
              <Pressable testID={`cf-del-${item.id}`} onPress={() => remove(item)} hitSlop={8} style={styles.delBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          )}
        />
      )}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Field</Text>
              <Pressable onPress={() => setModalOpen(false)} testID="cf-modal-close"><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <KeyboardAwareScrollView bottomOffset={20} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Field Name</Text>
              <TextInput testID="cf-label" value={label} onChangeText={setLabel} placeholder="e.g. Shop Size"
                placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />

              <Text style={styles.label}>Answer Type</Text>
              <View style={styles.typeRow}>
                {TYPES.map(t => (
                  <Pressable key={t.key} testID={`cf-type-${t.key}`} onPress={() => setType(t.key)}
                    style={[styles.typeBtn, type === t.key && styles.typeBtnActive]}>
                    <Ionicons name={t.icon} size={18} color={type === t.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                    <Text style={[styles.typeText, type === t.key && { color: colors.onBrandPrimary }]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              {(type === "dropdown" || type === "multiselect") && (
                <>
                  <Text style={styles.label}>Options (comma separated)</Text>
                  <TextInput testID="cf-options" value={optionsText} onChangeText={setOptionsText} placeholder="Small, Medium, Large"
                    placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </>
              )}

              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable testID="cf-save-btn" onPress={save} disabled={saving} style={styles.saveBtn}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Create Field</Text>}
              </Pressable>
            </KeyboardAwareScrollView>
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
  hint: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  typeBadge: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  fieldLabel: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  fieldMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2, textTransform: "capitalize" },
  delBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600", marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  typeBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeText: { fontWeight: "700", color: colors.onSurfaceSecondary },
  error: { color: colors.error, fontWeight: "600", marginTop: spacing.sm },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
