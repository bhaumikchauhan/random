import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { colors, spacing, radius, font } from "@/src/theme";

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || "?"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.roleText}>{user?.role === "admin" ? "Administrator" : "Salesman"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Row icon="finger-print" label="Attendance" onPress={() => router.push("/attendance")} testID="menu-attendance" />
          <Row icon="alert-circle" label="Outstanding payments" onPress={() => router.push("/outstanding")} testID="menu-outstanding" />
          {isAdmin && (
            <>
              <Row icon="checkmark-done" label="Customer approvals" onPress={() => router.push("/approvals")} testID="menu-approvals" />
              <Row icon="receipt" label="Bills" onPress={() => router.push("/orders")} testID="menu-orders" />
              <Row icon="cube" label="Items / Products" onPress={() => router.push("/items")} testID="menu-items" />
              <Row icon="cloud-upload" label="Import customers" onPress={() => router.push("/import-customers")} testID="menu-import-customers" />
              <Row icon="download" label="Import items" onPress={() => router.push("/import-items")} testID="menu-import-items" />
              <Row icon="logo-whatsapp" label="Bulk WhatsApp" onPress={() => router.push("/bulk-whatsapp")} testID="menu-bulk-whatsapp" />
              <Row icon="git-branch" label="Routes" onPress={() => router.push("/routes")} testID="menu-routes" />
              <Row icon="construct" label="Custom fields" onPress={() => router.push("/customer-fields")} testID="menu-custom-fields" />
              <Row icon="clipboard" label="Bill tasks" onPress={() => router.push("/visit-tasks")} testID="menu-visit-tasks" />
              <Row icon="trophy" label="Salesman leaderboard" onPress={() => router.push("/leaderboard")} testID="menu-leaderboard" />
              <Row icon="briefcase" label="Manage salesmen" onPress={() => router.push("/salesmen")} testID="menu-salesmen" />
            </>
          )}
          {!isAdmin && (
            <>
              <Row icon="receipt" label="My bills" onPress={() => router.push("/orders")} testID="menu-orders" />
              <Row icon="navigate" label="Today's beat plan" onPress={() => router.push("/beat-plan")} testID="menu-beat-plan" />
            </>
          )}
          <Row icon="person-add" label="Add customer" onPress={() => router.push("/customer/new")} testID="menu-add-customer" />
        </View>

        <Pressable onPress={logout} testID="menu-logout" style={({ pressed }) => [styles.logout, pressed && { opacity: 0.8 }]}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>

        <Text style={styles.version}>FieldForce CRM • v1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, onPress, testID }: any) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.brandPrimary} /></View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  profileCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg,
    flexDirection: "row", gap: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontSize: font.xl, fontWeight: "700" },
  name: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  email: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  rolePill: { alignSelf: "flex-start", backgroundColor: colors.brandPrimary, marginTop: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 2, borderRadius: radius.pill },
  roleText: { color: colors.onBrandPrimary, fontSize: font.sm, fontWeight: "700" },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  logout: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  logoutText: { color: colors.error, fontWeight: "700", fontSize: font.base },
  version: { textAlign: "center", color: colors.onSurfaceTertiary, fontSize: font.sm, marginTop: spacing.md },
});
