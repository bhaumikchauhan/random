import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Route } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";
import { confirmDialog } from "@/src/utils/dialog";

export default function Routes() {
  const { token } = useAuth();
  const router = useRouter();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    try { setRoutes(await api.listRoutes(token)); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const add = async () => {
    if (!name.trim() || !token) return;
    setSaving(true);
    try { await api.createRoute(token, name.trim()); setName(""); await load(); }
    catch (e: any) { Alert.alert("Error", e.message || "Could not add route"); }
    finally { setSaving(false); }
  };

  const remove = async (r: Route) => {
    const ok = await confirmDialog("Delete Route", `Delete "${r.name}"?`, { confirmText: "Delete", destructive: true });
    if (!ok || !token) return;
    try { await api.deleteRoute(token, r.id); setRoutes(prev => prev.filter(x => x.id !== r.id)); }
    catch (e) { console.warn(e); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="routes-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Routes ({routes.length})</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView bottomOffset={20} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.addRow}>
          <TextInput testID="route-name-input" value={name} onChangeText={setName} placeholder="New route name (e.g. MG Road)"
            placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} onSubmitEditing={add} />
          <Pressable testID="route-add-btn" onPress={add} disabled={saving} style={styles.addBtn}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Ionicons name="add" size={24} color={colors.onBrandPrimary} />}
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
        ) : routes.length === 0 ? (
          <EmptyState title="No routes yet" subtitle="Add routes so they can be assigned to customers." icon="git-branch-outline" />
        ) : (
          <FlatList
            scrollEnabled={false}
            data={routes}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`route-row-${item.id}`}>
                <Ionicons name="git-branch" size={18} color={colors.brandPrimary} />
                <Text style={styles.routeName}>{item.name}</Text>
                <Pressable testID={`route-del-${item.id}`} onPress={() => remove(item)} hitSlop={8} style={styles.delBtn}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </View>
            )}
          />
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  addBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  routeName: { flex: 1, fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  delBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
});
