import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";

import { useAuth } from "@/src/auth";
import { api, LocationPoint, Salesman, Visit } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Chip, EmptyState } from "@/src/components/ui";
import { MapView, Marker, Polyline, HAS_MAPS } from "@/src/components/MapKit";
import { fmtTime } from "@/src/utils/datetime";

function formatToday() {
  return new Date().toISOString().slice(0, 10);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const LIVE_REFRESH_MS = 30000;

export default function MapScreen() {
  const { token, user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [mode, setMode] = useState<"live" | "route">(isAdmin ? "live" : "route");

  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [salesmanId, setSalesmanId] = useState<string>("");
  const [date] = useState(formatToday());
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [live, setLive] = useState<LocationPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const timer = useRef<any>(null);

  const loadRoute = async () => {
    if (!token) return;
    try {
      if (isAdmin && salesmen.length === 0) {
        const s = await api.listSalesmen(token);
        setSalesmen(s);
        if (s.length > 0 && !salesmanId) setSalesmanId(s[0].id);
      }
      const params: any = { date };
      if (isAdmin && salesmanId) params.salesman_id = salesmanId;
      const [locs, allBills] = await Promise.all([
        api.listLocations(token, params),
        api.listOrders(token),
      ]);
      setPoints(locs);
      // Map bills (orders) with GPS to the pin shape, filtered by day + salesman
      const dayBills = allBills.filter(o => {
        if (!o.gps_lat || !o.gps_lng) return false;
        if (isAdmin && salesmanId && o.salesman_id !== salesmanId) return false;
        return (o.order_date || "").slice(0, 10) === date;
      }).map(o => ({
        id: o.id, gps_lat: o.gps_lat, gps_lng: o.gps_lng,
        customer_name: o.customer_name, visit_result: o.outcome || "Order", visit_date: o.order_date,
      }));
      setVisits(dayBills as any);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  const loadLive = async () => {
    if (!token) return;
    try {
      const latest = await api.latestLocations(token);
      setLive(latest);
      setLastRefresh(new Date());
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    if (mode === "live" && isAdmin) {
      loadLive();
      timer.current = setInterval(loadLive, LIVE_REFRESH_MS);
    } else {
      loadRoute();
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [token, salesmanId, mode]));

  const routeCenter = (() => {
    const p = points[0] || visits.find(v => v.gps_lat && v.gps_lng) as any;
    if (!p) return { latitude: 19.0760, longitude: 72.8777 };
    return { latitude: p.lat ?? p.gps_lat, longitude: p.lng ?? p.gps_lng };
  })();
  const liveCenter = live[0] ? { latitude: live[0].lat, longitude: live[0].lng } : { latitude: 19.0760, longitude: 72.8777 };

  const showNativeMap = Platform.OS !== "web" && HAS_MAPS && MapView;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{mode === "live" ? "Live Tracking" : "Route Map"}</Text>
          {mode === "live" && lastRefresh && (
            <Text style={styles.subtitle}>Updated {timeAgo(lastRefresh.toISOString())} • auto-refreshes</Text>
          )}
          {mode === "route" && <Text style={styles.subtitle}>{date}</Text>}
        </View>
        {isAdmin && (
          <View style={styles.modeToggle}>
            <Pressable testID="map-mode-live" onPress={() => setMode("live")} style={[styles.modeBtn, mode === "live" && styles.modeBtnActive]}>
              <View style={[styles.liveDot, { backgroundColor: mode === "live" ? colors.error : colors.onSurfaceTertiary }]} />
              <Text style={[styles.modeText, mode === "live" && styles.modeTextActive]}>Live</Text>
            </Pressable>
            <Pressable testID="map-mode-route" onPress={() => setMode("route")} style={[styles.modeBtn, mode === "route" && styles.modeBtnActive]}>
              <Text style={[styles.modeText, mode === "route" && styles.modeTextActive]}>Route</Text>
            </Pressable>
          </View>
        )}
      </View>

      {isAdmin && mode === "route" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipContent}>
          {salesmen.map(s => (
            <Chip key={s.id} label={s.name} active={salesmanId === s.id} onPress={() => setSalesmanId(s.id)} testID={`map-salesman-${s.id}`} />
          ))}
        </ScrollView>
      )}

      <View style={styles.mapBox}>
        {loading ? (
          <View style={styles.mapPlaceholder}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : !showNativeMap ? (
          mode === "live"
            ? <LiveFallback live={live} />
            : <WebMapFallback points={points} visits={visits} />
        ) : mode === "live" ? (
          <MapView style={StyleSheet.absoluteFill}
            initialRegion={{ latitude: liveCenter.latitude, longitude: liveCenter.longitude, latitudeDelta: 0.15, longitudeDelta: 0.15 }}>
            {live.map(l => (
              <Marker key={l.salesman_id} coordinate={{ latitude: l.lat, longitude: l.lng }}
                title={l.salesman_name} description={`Last seen ${timeAgo(l.timestamp)}`} pinColor={colors.error} />
            ))}
          </MapView>
        ) : (
          <MapView style={StyleSheet.absoluteFill}
            initialRegion={{ latitude: routeCenter.latitude, longitude: routeCenter.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }}>
            {visits.filter(v => v.gps_lat && v.gps_lng).map(v => (
              <Marker key={`v-${v.id}`} coordinate={{ latitude: v.gps_lat!, longitude: v.gps_lng! }}
                title={v.customer_name}
                description={`${v.visit_result} • ${fmtTime(v.visit_date)}`}
                pinColor={colors.brandPrimary} />
            ))}
            {points.length > 1 && Polyline && (
              <Polyline coordinates={points.map(p => ({ latitude: p.lat, longitude: p.lng }))} strokeColor={colors.brandPrimary} strokeWidth={3} />
            )}
            {points.length > 0 && Marker && (
              <Marker coordinate={{ latitude: points[points.length - 1].lat, longitude: points[points.length - 1].lng }} title="Latest" pinColor={colors.warning} />
            )}
          </MapView>
        )}
      </View>

      {mode === "live" ? (
        <View style={styles.livePanel}>
          <Text style={styles.panelTitle}>Team ({live.length})</Text>
          {live.length === 0 ? (
            <EmptyState title="No live data" subtitle="Locations appear when salesmen open the app." icon="location-outline" />
          ) : (
            <ScrollView style={{ maxHeight: 200 }}>
              {live.map(l => (
                <View key={l.salesman_id} style={styles.liveRow} testID={`live-row-${l.salesman_id}`}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{l.salesman_name?.[0]?.toUpperCase() || "?"}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.liveName}>{l.salesman_name}</Text>
                    <Text style={styles.liveMeta}>{l.lat.toFixed(4)}, {l.lng.toFixed(4)}</Text>
                  </View>
                  <View style={styles.seenPill}>
                    <View style={styles.liveDotSmall} />
                    <Text style={styles.seenText}>{timeAgo(l.timestamp)}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        <View style={styles.legend}>
          <Text style={styles.legendText}>📍 {visits.length} bills • 🛰 {points.length} location pings</Text>
          {visits.length === 0 && points.length === 0 && (
            <EmptyState title="No activity" subtitle="No bills or location data for this day." icon="location-outline" />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function LiveFallback({ live }: { live: LocationPoint[] }) {
  return (
    <View style={styles.webFallback}>
      <Image source="https://images.unsplash.com/photo-1661577804141-6f0180f82373?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"
        style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.webOverlay}>
        <Ionicons name="navigate-circle" size={44} color={colors.onBrandPrimary} />
        <Text style={styles.webTitle}>Live positions</Text>
        <Text style={styles.webSub}>The live map with pins shows on your phone. Here is the latest known position of each salesman.</Text>
        <ScrollView style={{ maxHeight: 220, width: "100%" }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
          {live.map(l => (
            <View key={l.salesman_id} style={styles.webPin}>
              <Ionicons name="location" size={16} color={colors.error} />
              <Text style={styles.webPinText} numberOfLines={1}>{l.salesman_name} — {timeAgo(l.timestamp)}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function WebMapFallback({ points, visits }: { points: LocationPoint[]; visits: Visit[] }) {
  return (
    <View style={styles.webFallback}>
      <Image source="https://images.unsplash.com/photo-1661577804141-6f0180f82373?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"
        style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.webOverlay}>
        <Ionicons name="map" size={44} color={colors.onBrandPrimary} />
        <Text style={styles.webTitle}>Map preview</Text>
        <Text style={styles.webSub}>Native maps show on device. Web preview shows a summary.</Text>
        <ScrollView style={{ maxHeight: 240, width: "100%" }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
          {visits.map(v => (
            <View key={v.id} style={styles.webPin}>
              <Ionicons name="location" size={16} color={colors.brandPrimary} />
              <Text style={styles.webPinText} numberOfLines={1}>{v.customer_name} — {v.visit_result}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: font.xxl, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  modeToggle: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, padding: 3 },
  modeBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  modeBtnActive: { backgroundColor: colors.surface },
  modeText: { fontSize: font.sm, fontWeight: "700", color: colors.onSurfaceSecondary },
  modeTextActive: { color: colors.onSurface },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  chipRow: { flexGrow: 0, maxHeight: 56, backgroundColor: colors.surface },
  chipContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.sm },
  mapBox: { flex: 1, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  mapPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  legend: { padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border },
  legendText: { color: colors.onSurfaceSecondary, fontSize: font.base, fontWeight: "600" },
  livePanel: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.lg, paddingTop: spacing.md },
  panelTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  liveRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: font.base },
  liveName: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  liveMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  seenPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  liveDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  seenText: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600" },
  webFallback: { flex: 1 },
  webOverlay: { flex: 1, backgroundColor: "rgba(28,25,23,0.7)", padding: spacing.lg, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  webTitle: { color: colors.onSurfaceInverse, fontSize: font.xl, fontWeight: "700" },
  webSub: { color: colors.onSurfaceInverse, opacity: 0.9, textAlign: "center", marginBottom: spacing.md },
  webPin: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.sm },
  webPinText: { color: colors.onSurface, fontSize: font.base, flex: 1 },
});
