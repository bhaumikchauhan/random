import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Keyboard,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { colors, spacing, radius, font } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("admin@fmcg.com");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    Keyboard.dismiss();
    setErr(null);
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      if (u.role === "admin") router.replace("/(admin)/dashboard");
      else router.replace("/(salesman)/day");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.heroBox}>
        <Image source={HERO} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["transparent", "rgba(28,25,23,0.7)", "#1C1917"]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={["top"]} style={styles.heroContent}>
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Ionicons name="storefront" size={22} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.brandName}>FieldForce CRM</Text>
          </View>
          <Text style={styles.tagline}>Your FMCG field sales assistant</Text>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.formWrap}
      >
        <ScrollView
          contentContainerStyle={styles.formScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Log in to continue</Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="login-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              autoComplete="email"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="login-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.onSurfaceTertiary}
              secureTextEntry
              style={styles.input}
            />

            {err && <Text testID="login-error-text" style={styles.error}>{err}</Text>}

            <Pressable
              testID="login-submit-button"
              onPress={submit}
              disabled={busy}
              style={({ pressed }) => [styles.primaryBtn, (pressed || busy) && { opacity: 0.85 }]}
            >
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> :
                <Text style={styles.primaryBtnText}>Log in</Text>}
            </Pressable>

            <View style={styles.hintBox}>
              <Text style={styles.hintTitle}>Demo credentials</Text>
              <Text style={styles.hintText}>Admin: admin@fmcg.com / admin123</Text>
              <Text style={styles.hintText}>Salesman: john@fmcg.com / sales123</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  heroBox: { height: "35%", justifyContent: "flex-end" },
  heroContent: {
    padding: spacing.xl,
    justifyContent: "space-between",
    height: "100%",
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  brandName: { color: colors.onSurfaceInverse, fontSize: font.xl, fontWeight: "700" },
  tagline: { color: colors.onSurfaceInverse, fontSize: font.base, opacity: 0.9 },
  formWrap: { flex: 1, marginTop: -20 },
  formScroll: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.md },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm, fontWeight: "600" },
  input: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: font.lg, color: colors.onSurface,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
  error: {
    color: colors.error, marginTop: spacing.xs, fontSize: font.base, fontWeight: "600",
  },
  hintBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hintTitle: { fontWeight: "700", color: colors.onBrandTertiary, marginBottom: 2 },
  hintText: { color: colors.onBrandTertiary, fontSize: font.sm },
});
