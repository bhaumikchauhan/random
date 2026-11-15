import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

import { useAuth } from "@/src/auth";
import { api, AttendanceToday, fileUrl } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { confirmDialog } from "@/src/utils/dialog";

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

function isSameDayIST(iso?: string) {
  if (!iso) return false;
  const key = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  return key(new Date(iso)) === key(new Date());
}

export default function SalesmanAttendance() {
  const { token } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<AttendanceToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    try { setData(await api.attendanceToday(token)); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token]));

  const capture = async (): Promise<{ lat?: number; lng?: number; photo?: string } | null> => {
    setError(null);
    // 1. selfie
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (!camPerm.granted) {
      setError(camPerm.canAskAgain ? "Camera needed for attendance selfie." : "Camera blocked. Enable it in Settings.");
      return null;
    }
    const res = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.5,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]) return null;

    let photo: string | undefined;
    try {
      const up = await api.uploadImage(token!, res.assets[0].uri, "selfie.jpg");
      photo = up.path;
    } catch (e: any) {
      setError("Photo upload failed. Try again.");
      return null;
    }

    // 2. location (optional)
    let lat: number | undefined, lng: number | undefined;
    try {
      const locPerm = await Location.requestForegroundPermissionsAsync();
      if (locPerm.granted) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude; lng = loc.coords.longitude;
      }
    } catch {}
    return { lat, lng, photo };
  };

  const doCheckIn = async () => {
    setBusy(true);
    try {
      const c = await capture();
      if (!c) return;
      const rec = await api.checkIn(token!, c);
      if (rec.warning) setError(rec.warning);
      await load();
    } catch (e: any) { setError(e.message || "Check-in failed"); }
    finally { setBusy(false); }
  };

  const doCheckOut = async () => {
    // Beat reminder: warn about beat-plan shops still unbilled today
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [plan, orders] = await Promise.all([
        api.getBeatPlan(token!, { date: today }),
        api.listOrders(token!),
      ]);
      const billedToday = new Set(orders.filter(o => isSameDayIST(o.order_date)).map(o => o.customer_id));
      const unbilled = plan.stops.filter(s => !billedToday.has(s.customer_id));
      if (unbilled.length > 0) {
        const names = unbilled.slice(0, 6).map(s => `• ${s.shop_name}`).join("\n");
        const more = unbilled.length > 6 ? `\n…and ${unbilled.length - 6} more` : "";
        const proceed = await confirmDialog(
          `${unbilled.length} shop${unbilled.length > 1 ? "s" : ""} still unbilled`,
          `These Beat Plan shops have no bill today:\n\n${names}${more}\n\nCheck out anyway?`,
          { confirmText: "Check out anyway", cancelText: "Not yet", destructive: true }
        );
        if (!proceed) return;
      }
    } catch (e) { console.warn(e); }

    setBusy(true);
    try {
      const c = await capture();
      if (!c) return;
      await api.checkOut(token!, c);
      await load();
    } catch (e: any) { setError(e.message || "Check-out failed"); }
    finally { setBusy(false); }
  };

  const rec = data?.record;
  const checkedIn = data?.checked_in;
  const checkedOut = data?.checked_out;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="attendance-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Attendance</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={styles.statusCard}>
            <View style={[styles.statusDot, { backgroundColor: checkedOut ? colors.info : checkedIn ? colors.success : colors.warning }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>Today, {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short" })}</Text>
              <Text style={styles.statusText}>
                {checkedOut ? "Shift complete" : checkedIn ? "Currently working" : "Not checked in yet"}
              </Text>
            </View>
          </View>

          <View style={styles.timeRow}>
            <TimeBox label="Check In" time={fmtTime(rec?.check_in_time)} icon="log-in" photo={fileUrl(rec?.check_in_photo || undefined)} />
            <TimeBox label="Check Out" time={fmtTime(rec?.check_out_time)} icon="log-out" photo={fileUrl(rec?.check_out_photo || undefined)} />
          </View>

          {rec?.total_hours != null && (
            <View style={styles.hoursCard}>
              <Ionicons name="time" size={20} color={colors.brandPrimary} />
              <Text style={styles.hoursText}>Total: {rec.total_hours} hours worked</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              {error.includes("Settings") && (
                <Pressable onPress={() => Linking.openSettings()}><Text style={styles.settingsLink}>Open Settings</Text></Pressable>
              )}
            </View>
          )}

          {!checkedIn && (
            <Pressable testID="check-in-btn" onPress={doCheckIn} disabled={busy} style={styles.actionBtn}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <><Ionicons name="camera" size={20} color={colors.onBrandPrimary} /><Text style={styles.actionText}>Take Selfie & Check In</Text></>
              )}
            </Pressable>
          )}
          {checkedIn && !checkedOut && (
            <Pressable testID="check-out-btn" onPress={doCheckOut} disabled={busy} style={[styles.actionBtn, { backgroundColor: colors.surfaceInverse }]}>
              {busy ? <ActivityIndicator color={colors.onSurfaceInverse} /> : (
                <><Ionicons name="camera" size={20} color={colors.onSurfaceInverse} /><Text style={styles.actionText}>Take Selfie & Check Out</Text></>
              )}
            </Pressable>
          )}
          {checkedOut && (
            <View style={styles.doneBox}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={styles.doneText}>You've completed today's attendance. See you tomorrow!</Text>
            </View>
          )}

          <Text style={styles.note}>Your selfie and location are recorded as proof of attendance.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function TimeBox({ label, time, icon, photo }: any) {
  return (
    <View style={styles.timeBox}>
      <View style={styles.timeHeader}>
        <Ionicons name={icon} size={16} color={colors.onSurfaceSecondary} />
        <Text style={styles.timeLabel}>{label}</Text>
      </View>
      {photo ? (
        <Image source={photo} style={styles.selfie} contentFit="cover" />
      ) : (
        <View style={[styles.selfie, styles.selfieEmpty]}><Ionicons name="person" size={28} color={colors.onSurfaceTertiary} /></View>
      )}
      <Text style={styles.timeValue}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  statusCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  statusText: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface, marginTop: 2 },
  timeRow: { flexDirection: "row", gap: spacing.md },
  timeBox: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: spacing.sm },
  timeHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  timeLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600" },
  selfie: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  selfieEmpty: { alignItems: "center", justifyContent: "center" },
  timeValue: { fontSize: font.lg, fontWeight: "800", color: colors.onSurface },
  hoursCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md },
  hoursText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: font.base },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md },
  actionText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
  doneBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#F0FDF4", borderRadius: radius.md, padding: spacing.md },
  doneText: { flex: 1, color: colors.success, fontWeight: "600" },
  errorBox: { backgroundColor: "#FEE2E2", borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  errorText: { color: colors.error, fontWeight: "600" },
  settingsLink: { color: colors.error, fontWeight: "700", textDecorationLine: "underline" },
  note: { fontSize: font.sm, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: spacing.sm },
});
