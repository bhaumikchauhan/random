import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Salesman } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";

export default function Salesmen() {
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Salesman[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [area, setArea] = useState("");
  const [password, setPassword] = useState("");
  const [radius, setRadius] = useState("10");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    try { setItems(await api.listSalesmen(token)); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const create = async () => {
    setError(null);
    if (!name.trim() || !email.trim() || password.length < 4) {
      setError("Name, email and a password (min 4 chars) are required");
      return;
    }
    if (!token) return;
    setSaving(true);
    try {
      await api.createSalesman(token, { name, email: email.trim().toLowerCase(), mobile, area, password, geofence_radius_km: Number(radius) || 10 });
      setName(""); setEmail(""); setMobile(""); setArea(""); setPassword(""); setRadius("10");
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message || "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: Salesman) => {
    if (!token) return;
    await api.updateSalesman(token, s.id, { active: !s.active });
    load();
  };

  const toggleCanEdit = async (s: Salesman) => {
    if (!token) return;
    setItems(prev => prev.map(x => x.id === s.id ? { ...x, can_edit_customers: !x.can_edit_customers } : x));
    try { await api.updateSalesman(token, s.id, { can_edit_customers: !s.can_edit_customers }); }
    catch (e) { console.warn(e); load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="salesmen-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Salesmen</Text>
        <Pressable onPress={() => setShowForm(s => !s)} testID="toggle-add-salesman" style={styles.iconBtn}>
          <Ionicons name={showForm ? "close" : "add"} size={24} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {showForm && (
        <KeyboardAwareScrollView style={styles.formWrap} contentContainerStyle={{ padding: spacing.lg }} bottomOffset={20}>
          <Text style={styles.formTitle}>New Salesman</Text>
          <TextInput testID="sm-name" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="sm-email" value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="sm-mobile" value={mobile} onChangeText={setMobile} placeholder="Mobile" keyboardType="phone-pad" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="sm-area" value={area} onChangeText={setArea} placeholder="Area" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="sm-radius" value={radius} onChangeText={setRadius} placeholder="Check-in allowed radius (km)" keyboardType="numeric" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="sm-password" value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable testID="sm-create-btn" onPress={create} disabled={saving} style={styles.createBtn}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.createText}>Create Salesman</Text>}
          </Pressable>
        </KeyboardAwareScrollView>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState title="No salesmen" subtitle="Tap + to add your first salesman." icon="people-outline" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`salesman-row-${item.id}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.name[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>{item.email}</Text>
                <Text style={styles.meta}>{item.mobile || "—"}{item.area ? ` • ${item.area}` : ""}</Text>
                <Text style={styles.meta}>Check-in radius: {item.geofence_radius_km ?? 10} km</Text>
                <Pressable testID={`salesman-canedit-${item.id}`} onPress={() => toggleCanEdit(item)} style={styles.editPermRow}>
                  <Ionicons name={item.can_edit_customers ? "checkbox" : "square-outline"} size={18} color={item.can_edit_customers ? colors.brandPrimary : colors.onSurfaceTertiary} />
                  <Text style={styles.editPermText}>Can edit customers</Text>
                </Pressable>
              </View>
              <View style={{ alignItems: "center", gap: 2 }}>
                <Switch
                  testID={`salesman-active-${item.id}`}
                  value={item.active}
                  onValueChange={() => toggleActive(item)}
                  trackColor={{ true: colors.brandSecondary, false: colors.surfaceTertiary }}
                />
                <Text style={styles.activeLabel}>{item.active ? "Active" : "Disabled"}</Text>
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
  formWrap: { maxHeight: 420, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border },
  formTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface, marginBottom: spacing.sm },
  errorText: { color: colors.error, fontWeight: "600", marginBottom: spacing.sm },
  createBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  createText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.base },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: font.lg },
  name: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  activeLabel: { fontSize: 10, color: colors.onSurfaceSecondary, fontWeight: "600" },
  editPermRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  editPermText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: "600" },
});
