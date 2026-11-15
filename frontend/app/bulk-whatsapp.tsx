import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, ScrollView, Image, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";

import { useAuth } from "@/src/auth";
import { api, Customer, Route } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Chip, EmptyState } from "@/src/components/ui";
import { openWhatsApp } from "@/src/whatsapp";

const TYPES = ["All", "Retailer", "Wholesaler", "Distributor"];
const DEFAULT_MSG = "Hi {shop_name}, we have new stock and offers this week. Please share your requirement so we can plan your delivery. Thank you!";

function personalize(msg: string, c: Customer) {
  return msg.replace(/\{shop_name\}/gi, c.shop_name || "").replace(/\{name\}/gi, c.owner_name || c.shop_name || "");
}

export default function BulkWhatsApp() {
  const { token } = useAuth();
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [routeFilter, setRouteFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [idx, setIdx] = useState(0);
  const [sentIds, setSentIds] = useState<Record<string, boolean>>({});

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) Alert.alert("Photo access blocked", "Enable photo access in Settings to attach a picture.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (res.canceled || !res.assets?.[0]) return;
    setImageUri(res.assets[0].uri);
  };

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const [cs, rts] = await Promise.all([api.listCustomers(token, { approval: "approved" }), api.listRoutes(token)]);
        setCustomers(cs.filter(c => c.mobile || c.whatsapp));
        setRoutes(rts);
      } catch (e) { console.warn(e); }
      finally { setLoading(false); }
    })();
  }, [token]);

  const filtered = useMemo(() => customers.filter(c =>
    (routeFilter === "All" || c.route === routeFilter) &&
    (typeFilter === "All" || c.customer_type === typeFilter) &&
    (!q || c.shop_name.toLowerCase().includes(q.toLowerCase()))
  ), [customers, routeFilter, typeFilter, q]);

  const selectedList = customers.filter(c => selected[c.id]);
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected[c.id]);

  const toggle = (id: string) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const toggleAll = () => {
    setSelected(s => {
      const next = { ...s };
      const target = !allFilteredSelected;
      filtered.forEach(c => { next[c.id] = target; });
      return next;
    });
  };

  const startSending = () => { setIdx(0); setSentIds({}); setSending(true); };

  const current = selectedList[idx];
  const openCurrent = async () => {
    if (!current) return;
    await openWhatsApp(current.whatsapp || current.mobile, personalize(message, current));
  };
  const shareImageCurrent = async () => {
    if (!imageUri) return;
    if (Platform.OS === "web") { Alert.alert("Not on web", "Attaching a picture works on the phone app, not the web preview."); return; }
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(imageUri, { mimeType: "image/jpeg", dialogTitle: "Share to WhatsApp" });
      }
    } catch (e: any) { Alert.alert("Error", e.message || "Could not share image"); }
  };
  const nextCustomer = () => {
    if (current) setSentIds(s => ({ ...s, [current.id]: true }));
    setIdx(i => i + 1);
  };

  if (loading) {
    return <SafeAreaView style={styles.root}><View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>;
  }

  // ---- Sending phase ----
  if (sending) {
    const done = idx >= selectedList.length;
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => setSending(false)} testID="bw-send-back" style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Sending {Math.min(idx + (done ? 0 : 1), selectedList.length)}/{selectedList.length}</Text>
          <View style={{ width: 40 }} />
        </View>

        {done ? (
          <View style={styles.center}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            <Text style={styles.doneTitle}>All done!</Text>
            <Text style={styles.doneSub}>Messages opened for {selectedList.length} customers.</Text>
            <Pressable testID="bw-finish" onPress={() => router.back()} style={styles.primaryBtn}>
              <Text style={styles.primaryText}>Finish</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            <View style={styles.currentCard}>
              <Text style={styles.currentShop}>{current.shop_name}</Text>
              <Text style={styles.currentMeta}>{current.owner_name || ""} {current.route ? `• ${current.route}` : ""}</Text>
              <Text style={styles.currentPhone}>{current.whatsapp || current.mobile}</Text>
            </View>
            <View style={styles.previewCard}>
              <Text style={styles.previewLabel}>Message preview</Text>
              <Text style={styles.previewText}>{personalize(message, current)}</Text>
            </View>
            <Pressable testID="bw-open-wa" onPress={openCurrent} style={styles.waBtn}>
              <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              <Text style={styles.waText}>Send text</Text>
            </Pressable>
            {imageUri && (
              <Pressable testID="bw-share-img" onPress={shareImageCurrent} style={styles.imgBtn}>
                <Ionicons name="image" size={20} color={colors.brandPrimary} />
                <Text style={styles.imgBtnText}>Send image (pick this customer in WhatsApp)</Text>
              </Pressable>
            )}
            <Pressable testID="bw-next" onPress={nextCustomer} style={styles.nextBtn}>
              <Text style={styles.nextText}>{idx === selectedList.length - 1 ? "Mark sent & Finish" : "Mark sent & Next"}</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.brandPrimary} />
            </Pressable>
            <Text style={styles.tip}>Tip: after sending in WhatsApp, come back and tap Next.</Text>
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // ---- Selection phase ----
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="bw-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Bulk WhatsApp</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.onSurfaceSecondary} />
        <TextInput testID="bw-search" value={q} onChangeText={setQ} placeholder="Search customer..." placeholderTextColor={colors.onSurfaceTertiary} style={styles.search} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipContent}>
        <Chip label="All Routes" active={routeFilter === "All"} onPress={() => setRouteFilter("All")} testID="bw-route-All" />
        {routes.map(r => (
          <Chip key={r.id} label={r.name} active={routeFilter === r.name} onPress={() => setRouteFilter(r.name)} testID={`bw-route-${r.name}`} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipContent}>
        {TYPES.map(t => (
          <Chip key={t} label={t} active={typeFilter === t} onPress={() => setTypeFilter(t)} testID={`bw-type-${t}`} />
        ))}
      </ScrollView>

      <View style={styles.selectBar}>
        <Pressable testID="bw-select-all" onPress={toggleAll} style={styles.selectAllBtn}>
          <Ionicons name={allFilteredSelected ? "checkbox" : "square-outline"} size={20} color={colors.brandPrimary} />
          <Text style={styles.selectAllText}>Select all ({filtered.length})</Text>
        </Pressable>
        <Text style={styles.selCount}>{selectedList.length} selected</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100, gap: spacing.sm }}
        ListEmptyComponent={<EmptyState title="No customers" subtitle="Adjust filters to find customers with a phone number." icon="people-outline" />}
        renderItem={({ item }) => (
          <Pressable testID={`bw-cust-${item.id}`} onPress={() => toggle(item.id)} style={[styles.custCard, selected[item.id] && styles.custCardActive]}>
            <Ionicons name={selected[item.id] ? "checkbox" : "square-outline"} size={22} color={selected[item.id] ? colors.brandPrimary : colors.onSurfaceTertiary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.custName}>{item.shop_name}</Text>
              <Text style={styles.custMeta}>{item.route || item.area || "—"} • {item.customer_type || "—"} • {item.whatsapp || item.mobile}</Text>
            </View>
          </Pressable>
        )}
      />

      <SafeAreaView edges={["bottom"]} style={styles.footer}>
        <Text style={styles.msgLabel}>Message (use {"{shop_name}"} to personalize)</Text>
        <TextInput testID="bw-message" value={message} onChangeText={setMessage} multiline placeholderTextColor={colors.onSurfaceTertiary}
          style={styles.msgInput} />
        <View style={styles.attachRow}>
          <Pressable testID="bw-attach" onPress={pickImage} style={styles.attachBtn}>
            <Ionicons name={imageUri ? "image" : "image-outline"} size={18} color={colors.brandPrimary} />
            <Text style={styles.attachText}>{imageUri ? "Change picture" : "Attach picture"}</Text>
          </Pressable>
          {imageUri && (
            <>
              <Image source={{ uri: imageUri }} style={styles.thumb} />
              <Pressable testID="bw-remove-img" onPress={() => setImageUri(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.error} />
              </Pressable>
            </>
          )}
        </View>
        <Pressable testID="bw-start" onPress={startSending} disabled={selectedList.length === 0}
          style={[styles.startBtn, selectedList.length === 0 && { opacity: 0.5 }]}>
          <Ionicons name="logo-whatsapp" size={20} color="#fff" />
          <Text style={styles.startText}>Start Sending ({selectedList.length})</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  searchWrap: { marginHorizontal: spacing.lg, marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44 },
  search: { flex: 1, color: colors.onSurface, fontSize: font.base },
  chipRow: { flexGrow: 0, maxHeight: 52, backgroundColor: colors.surfaceSecondary },
  chipContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.xs },
  selectBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  selectAllBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  selectAllText: { fontWeight: "700", color: colors.brandPrimary },
  selCount: { fontWeight: "700", color: colors.onSurfaceSecondary },
  custCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  custCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  custName: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  custMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  msgLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600" },
  msgInput: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.base, color: colors.onSurface, minHeight: 60, textAlignVertical: "top" },
  startBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: "#25D366", borderRadius: radius.md, paddingVertical: spacing.md },
  startText: { color: "#fff", fontWeight: "800", fontSize: font.lg },
  currentCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  currentShop: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },
  currentMeta: { fontSize: font.base, color: colors.onSurfaceSecondary, marginTop: 2 },
  currentPhone: { fontSize: font.base, color: colors.brandPrimary, fontWeight: "700", marginTop: spacing.xs },
  previewCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  previewLabel: { fontSize: font.sm, fontWeight: "700", color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  previewText: { fontSize: font.base, color: colors.onSurface, lineHeight: 21 },
  waBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: "#25D366", borderRadius: radius.md, paddingVertical: spacing.md },
  waText: { color: "#fff", fontWeight: "800", fontSize: font.lg },
  imgBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  imgBtnText: { color: colors.brandPrimary, fontWeight: "700", fontSize: font.sm },
  attachRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  attachBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  attachText: { color: colors.brandPrimary, fontWeight: "700" },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  nextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  nextText: { color: colors.brandPrimary, fontWeight: "800", fontSize: font.base },
  tip: { fontSize: font.sm, color: colors.onSurfaceTertiary, textAlign: "center" },
  doneTitle: { fontSize: font.xl, fontWeight: "800", color: colors.onSurface },
  doneSub: { fontSize: font.base, color: colors.onSurfaceSecondary },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, marginTop: spacing.md },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
