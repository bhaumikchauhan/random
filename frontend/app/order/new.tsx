import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Modal,
  KeyboardAvoidingView, Platform, FlatList, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";

import { useAuth } from "@/src/auth";
import { api, Customer, Item, Route, VisitTaskConfig, fileUrl } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { Chip, formatCurrency } from "@/src/components/ui";

const OUTCOMES = ["Order", "No Order", "Follow-up"];
const NO_ORDER_REASONS = ["Shop Closed", "No Stock", "Price Issue", "Already Stocked", "Owner Absent"];

type Line = { item: Item; qty: string; discount: string; free_qty: string };

function lineNet(l: Line) {
  const qty = Number(l.qty) || 0;
  const gross = qty * l.item.rate;
  const afterDisc = gross * (1 - (Number(l.discount) || 0) / 100);
  const net = afterDisc * (1 + l.item.tax_rate / 100);
  return Math.round(net * 100) / 100;
}

export default function NewOrder() {
  const { customer_id, order_id } = useLocalSearchParams<{ customer_id?: string; order_id?: string }>();
  const { token, user } = useAuth();
  const router = useRouter();
  const editing = !!order_id;
  const isSalesman = user?.role === "salesman";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeFilter, setRouteFilter] = useState<string>("All");
  const [selected, setSelected] = useState<string | undefined>(customer_id);
  const [lines, setLines] = useState<Line[]>([]);
  const [remarks, setRemarks] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("Order");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [taskConfig, setTaskConfig] = useState<VisitTaskConfig | null>(null);
  const [taskPhoto, setTaskPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [followupDays, setFollowupDays] = useState<number | null>(null);
  const [beatIds, setBeatIds] = useState<Set<string> | null>(null);
  const [noReason, setNoReason] = useState<string | null>(null);
  const [noNote, setNoNote] = useState("");

  const fetchGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch (e) { console.warn(e); }
  };

  const setAns = (id: string, v: any) => setAnswers(a => ({ ...a, [id]: v }));

  const capturePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    let res;
    if (perm.granted) res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    else {
      const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!lib.granted) { setError("Camera/photo access blocked. Enable it in Settings."); return; }
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    }
    if (res.canceled || !res.assets?.[0] || !token) return;
    setPhotoBusy(true);
    try { const r = await api.uploadImage(token, res.assets[0].uri); setTaskPhoto(r.path); }
    catch (e: any) { setError(e.message || "Photo upload failed"); }
    finally { setPhotoBusy(false); }
  };

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const [cs, its, rts, cfg] = await Promise.all([api.listCustomers(token), api.listItems(token), api.listRoutes(token), api.applicableVisitTask(token)]);
        setCustomers(cs);
        setItems(its);
        setRoutes(rts);
        setTaskConfig(cfg);
        if (isSalesman) {
          try {
            const today = new Date().toISOString().slice(0, 10);
            const plan = await api.getBeatPlan(token, { date: today });
            setBeatIds(new Set(plan.stops.map(s => s.customer_id)));
          } catch { setBeatIds(new Set()); }
        }
        if (order_id) {
          const o = await api.getOrder(token, order_id);
          setSelected(o.customer_id);
          setRemarks(o.remarks || "");
          setOutcome(o.outcome || "Order");
          if (o.gps_lat != null && o.gps_lng != null) setGps({ lat: o.gps_lat, lng: o.gps_lng });
          if (o.task_photo) setTaskPhoto(o.task_photo);
          if (o.task_answers) setAnswers(o.task_answers);
          if (o.no_order_reason) setNoReason(o.no_order_reason);
          if (o.no_order_note) setNoNote(o.no_order_note);
          setLines(o.lines.map(l => ({
            item: { id: l.item_id, item_code: l.item_code, item_name: l.item_name, rate: l.rate, tax_rate: l.tax_rate, mrp: l.mrp, active: true },
            qty: String(l.qty), discount: String(l.discount), free_qty: String(l.free_qty),
          })));
        } else {
          fetchGPS();
        }
      } catch (e) { console.warn(e); }
    })();
  }, [token, order_id]);

  const total = useMemo(() => Math.round(lines.reduce((s, l) => s + lineNet(l), 0) * 100) / 100, [lines]);
  const selectedCustomer = customers.find(c => c.id === selected);

  const addItem = (it: Item) => {
    if (lines.some(l => l.item.id === it.id)) { setItemPickerOpen(false); return; }
    setLines(prev => [...prev, { item: it, qty: "1", discount: "0", free_qty: "0" }]);
    setItemPickerOpen(false);
    setItemSearch("");
  };
  const updateLine = (id: string, field: keyof Line, val: string) =>
    setLines(prev => prev.map(l => l.item.id === id ? { ...l, [field]: val } : l));
  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.item.id !== id));

  const save = async () => {
    setError(null);
    if (!selected) { setError("Select a customer"); return; }
    if (outcome === "Order" && lines.length === 0) { setError("Add at least one item for an Order"); return; }
    if (outcome === "No Order" && !noReason) { setError("Select a reason for No Order"); return; }
    if (taskConfig) {
      if (taskConfig.require_photo && !taskPhoto) { setError("A photo is required"); return; }
      for (const q of taskConfig.questions) {
        if (q.required) {
          const v = answers[q.id];
          if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) { setError(`Please answer: ${q.label}`); return; }
        }
      }
    }
    if (!token) return;
    setSaving(true);
    let labeled: Record<string, any> | undefined;
    if (taskConfig) {
      labeled = {};
      for (const q of taskConfig.questions) {
        const v = answers[q.id];
        if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) labeled[q.label] = v;
      }
      if (Object.keys(labeled).length === 0) labeled = undefined;
    }
    let next_followup: string | undefined;
    if (followupDays) { const d = new Date(); d.setDate(d.getDate() + followupDays); next_followup = d.toISOString(); }
    const payload = {
      customer_id: selected,
      remarks: remarks || undefined,
      lines: lines.map(l => ({ item_id: l.item.id, qty: Number(l.qty) || 0, discount: Number(l.discount) || 0, free_qty: Number(l.free_qty) || 0 })),
      outcome,
      gps_lat: gps?.lat,
      gps_lng: gps?.lng,
      next_followup: next_followup as any,
      task_photo: taskPhoto || undefined,
      task_answers: labeled,
      no_order_reason: outcome === "No Order" ? (noReason || undefined) : undefined,
      no_order_note: outcome === "No Order" ? (noNote.trim() || undefined) : undefined,
    };
    try {
      const order = editing
        ? await api.updateOrder(token, order_id!, payload)
        : await api.createOrder(token, payload);
      router.replace(`/order/${order.id}`);
    } catch (e: any) { setError(e.message || "Failed to save bill"); }
    finally { setSaving(false); }
  };

  const filteredCust = customers.filter(c =>
    (!isSalesman || (beatIds ? beatIds.has(c.id) : false)) &&
    (routeFilter === "All" || c.route === routeFilter) &&
    (!custSearch || c.shop_name.toLowerCase().includes(custSearch.toLowerCase()))
  );
  const beatEmpty = isSalesman && beatIds !== null && beatIds.size === 0;
  const availableItems = items.filter(i => !lines.some(l => l.item.id === i.id) &&
    (!itemSearch || i.item_name.toLowerCase().includes(itemSearch.toLowerCase()) || i.item_code.toLowerCase().includes(itemSearch.toLowerCase())));

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <Pressable onPress={() => router.back()} testID="order-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{editing ? "Edit Bill" : "New Bill"}</Text>
        <View style={{ width: 40 }} />
      </SafeAreaView>

      <KeyboardAwareScrollView contentContainerStyle={styles.body} bottomOffset={120} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Party Name</Text>
        {selectedCustomer ? (
          <Pressable testID="order-change-cust" onPress={() => setSelected(undefined)} style={styles.selectedCust}>
            <View><Text style={styles.selectedShop}>{selectedCustomer.shop_name}</Text><Text style={styles.selectedArea}>{selectedCustomer.area}</Text></View>
            <Text style={styles.changeText}>Change</Text>
          </Pressable>
        ) : (
          <>
            {beatEmpty ? (
              <View style={styles.beatHint}>
                <Ionicons name="navigate-outline" size={28} color={colors.brandPrimary} />
                <Text style={styles.beatHintTitle}>No shops in today's Beat Plan</Text>
                <Text style={styles.beatHintSub}>Add shops to your Beat Plan first — only those shops can be billed today.</Text>
                <Pressable testID="order-goto-beat" onPress={() => router.replace("/beat-plan")} style={styles.beatHintBtn}>
                  <Text style={styles.beatHintBtnText}>Open Beat Plan</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {routes.length > 0 && !isSalesman && (
                  <View style={styles.routeChips}>
                    <Chip label="All Routes" active={routeFilter === "All"} onPress={() => setRouteFilter("All")} testID="order-route-All" />
                    {routes.map(r => (
                      <Chip key={r.id} label={r.name} active={routeFilter === r.name} onPress={() => setRouteFilter(r.name)} testID={`order-route-${r.name}`} />
                    ))}
                  </View>
                )}
                <TextInput testID="order-cust-search" value={custSearch} onChangeText={setCustSearch} placeholder="Search customer..." placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                <View style={styles.custList}>
                  {filteredCust.slice(0, 8).map(c => (
                    <Pressable key={c.id} testID={`order-cust-${c.id}`} onPress={() => setSelected(c.id)} style={styles.custOption}>
                      <Text style={styles.custOptText}>{c.shop_name}</Text><Text style={styles.custOptArea}>{c.route || c.area}</Text>
                    </Pressable>
                  ))}
                  {filteredCust.length === 0 && <Text style={styles.emptyCust}>{isSalesman ? "No shops match." : "No customers in this route."}</Text>}
                </View>
              </>
            )}
          </>
        )}

        <Text style={styles.label}>Outcome</Text>
        <View style={styles.routeChips}>
          {OUTCOMES.map(o => (
            <Chip key={o} label={o} active={outcome === o} onPress={() => setOutcome(o)} testID={`order-outcome-${o}`} />
          ))}
        </View>
        {gps && <Text style={styles.gpsNote}>📍 Location captured</Text>}

        {outcome === "No Order" && (
          <>
            <Text style={styles.label}>Reason <Text style={styles.req}>*</Text></Text>
            <View style={styles.routeChips}>
              {NO_ORDER_REASONS.map(r => (
                <Pressable key={r} testID={`no-reason-${r}`} onPress={() => setNoReason(noReason === r ? null : r)}
                  style={[styles.optChip, noReason === r && styles.optChipActive]}>
                  <Text style={[styles.optChipText, noReason === r && styles.optChipTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="no-order-note" value={noNote} onChangeText={setNoNote} placeholder="Add a short note..." placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          </>
        )}

        <View style={styles.itemsHeader}>
          <Text style={styles.label}>Items ({lines.length}){outcome === "Order" ? " *" : ""}</Text>
          <Pressable testID="order-add-item" onPress={() => setItemPickerOpen(true)} style={styles.addItemBtn}>
            <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.addItemText}>Add Item</Text>
          </Pressable>
        </View>

        {lines.length === 0 && <Text style={styles.emptyLines}>{outcome === "Order" ? 'Add at least one item.' : 'No items needed for this outcome (optional).'}</Text>}

        {lines.map(l => (
          <View key={l.item.id} style={styles.lineCard} testID={`order-line-${l.item.id}`}>
            <View style={styles.lineTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName} numberOfLines={1}>{l.item.item_name}</Text>
                <Text style={styles.lineMeta}>{l.item.item_code} · Rate {formatCurrency(l.item.rate)} · Tax {l.item.tax_rate}% · MRP {formatCurrency(l.item.mrp)}</Text>
              </View>
              <Pressable testID={`order-line-del-${l.item.id}`} onPress={() => removeLine(l.item.id)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>
            <View style={styles.lineInputs}>
              <MiniInput label="Qty" value={l.qty} onChange={(v) => updateLine(l.item.id, "qty", v)} testID={`qty-${l.item.id}`} />
              <MiniInput label="Disc %" value={l.discount} onChange={(v) => updateLine(l.item.id, "discount", v)} testID={`disc-${l.item.id}`} />
              <MiniInput label="Free" value={l.free_qty} onChange={(v) => updateLine(l.item.id, "free_qty", v)} testID={`free-${l.item.id}`} />
              <View style={styles.netBox}>
                <Text style={styles.netLabel}>Net</Text>
                <Text style={styles.netValue}>{formatCurrency(lineNet(l))}</Text>
              </View>
            </View>
          </View>
        ))}

        {taskConfig && (taskConfig.require_photo || taskConfig.questions.length > 0) && (
          <View style={styles.taskBox}>
            <Text style={styles.taskHeading}>Visit Tasks</Text>
            {taskConfig.require_photo && (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={styles.label}>Photo <Text style={styles.req}>*</Text></Text>
                <Pressable testID="bill-task-photo" onPress={capturePhoto} style={styles.photoBox}>
                  {photoBusy ? <ActivityIndicator color={colors.brandPrimary} />
                    : taskPhoto ? <Image source={{ uri: fileUrl(taskPhoto) }} style={styles.photoImg} />
                    : <><Ionicons name="camera" size={26} color={colors.brandPrimary} /><Text style={styles.photoHint}>Tap to capture</Text></>}
                </Pressable>
              </View>
            )}
            {taskConfig.questions.map((q, i) => {
              const val = answers[q.id];
              return (
                <View key={q.id} style={{ marginBottom: spacing.md }}>
                  <Text style={styles.label}>{q.label}{q.required ? <Text style={styles.req}> *</Text> : null}</Text>
                  {q.type === "single" && (
                    <View style={styles.routeChips}>
                      {q.options.map(opt => (
                        <Pressable key={opt} testID={`bq-${i}-${opt}`} onPress={() => setAns(q.id, val === opt ? undefined : opt)}
                          style={[styles.optChip, val === opt && styles.optChipActive]}>
                          <Text style={[styles.optChipText, val === opt && styles.optChipTextActive]}>{opt}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {q.type === "multi" && (
                    <View style={styles.routeChips}>
                      {q.options.map(opt => {
                        const arr: string[] = Array.isArray(val) ? val : [];
                        const on = arr.includes(opt);
                        return (
                          <Pressable key={opt} testID={`bq-${i}-${opt}`} onPress={() => setAns(q.id, on ? arr.filter(x => x !== opt) : [...arr, opt])}
                            style={[styles.optChip, on && styles.optChipActive]}>
                            <Text style={[styles.optChipText, on && styles.optChipTextActive]}>{on ? "✓ " : ""}{opt}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  {(q.type === "text" || q.type === "number") && (
                    <TextInput testID={`bq-${i}`} value={val != null ? String(val) : ""}
                      onChangeText={v => setAns(q.id, q.type === "number" ? (v === "" ? undefined : Number(v) || 0) : v)}
                      keyboardType={q.type === "number" ? "numeric" : "default"}
                      placeholder="Your answer" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                  )}
                </View>
              );
            })}
          </View>
        )}

        {outcome === "Follow-up" && (
          <>
            <Text style={styles.label}>Follow up in</Text>
            <View style={styles.routeChips}>
              {[1, 3, 7, 15].map(d => (
                <Pressable key={d} testID={`bill-followup-${d}`} onPress={() => setFollowupDays(followupDays === d ? null : d)}
                  style={[styles.optChip, followupDays === d && styles.optChipActive]}>
                  <Text style={[styles.optChipText, followupDays === d && styles.optChipTextActive]}>{d} day{d > 1 ? "s" : ""}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>Remarks</Text>
        <TextInput testID="order-remarks" value={remarks} onChangeText={setRemarks} placeholder="Order notes..." placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { height: 64, textAlignVertical: "top" }]} multiline />

        {error && <Text style={styles.error}>{error}</Text>}
      </KeyboardAwareScrollView>

      <KeyboardStickyView>
        <SafeAreaView edges={["bottom"]} style={styles.footer}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Order Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(total)}</Text>
          </View>
          <Pressable testID="order-submit" onPress={save} disabled={saving} style={styles.saveBtn}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>{editing ? "Update Bill" : "Save Bill"}</Text>}
          </Pressable>
        </SafeAreaView>
      </KeyboardStickyView>

      <Modal visible={itemPickerOpen} transparent animationType="slide" onRequestClose={() => setItemPickerOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
          <View style={styles.pickerCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Item</Text>
              <Pressable onPress={() => setItemPickerOpen(false)} testID="item-picker-close"><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <TextInput testID="order-item-search" value={itemSearch} onChangeText={setItemSearch} placeholder="Search product or code..." placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <FlatList
              data={availableItems}
              keyExtractor={(i) => i.id}
              style={{ marginTop: spacing.sm }}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              ListEmptyComponent={<Text style={styles.emptyLines}>No items found.</Text>}
              renderItem={({ item }) => (
                <Pressable testID={`pick-item-${item.id}`} onPress={() => addItem(item)} style={styles.pickRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName}>{item.item_name}</Text>
                    <Text style={styles.pickMeta}>{item.item_code} · {formatCurrency(item.rate)} · Tax {item.tax_rate}%</Text>
                  </View>
                  <Ionicons name="add-circle" size={24} color={colors.brandPrimary} />
                </Pressable>
              )}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function MiniInput({ label, value, onChange, testID }: any) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniLabel}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} keyboardType="numeric" style={styles.miniInput} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600", marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  custList: { marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  custOption: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  custOptText: { fontSize: font.base, fontWeight: "600", color: colors.onSurface },
  custOptArea: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  selectedCust: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.md },
  selectedShop: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  selectedArea: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  routeChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  emptyCust: { fontSize: font.sm, color: colors.onSurfaceSecondary, padding: spacing.md, textAlign: "center" },
  beatHint: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: "center", gap: spacing.xs },
  beatHintTitle: { fontSize: font.base, fontWeight: "800", color: colors.onSurface, marginTop: spacing.xs },
  beatHintSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, textAlign: "center" },
  beatHintBtn: { marginTop: spacing.sm, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  beatHintBtnText: { color: colors.onBrandPrimary, fontWeight: "700" },
  changeText: { color: colors.brandPrimary, fontWeight: "700" },
  itemsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  addItemBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  addItemText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.sm },
  emptyLines: { color: colors.onSurfaceTertiary, fontSize: font.base, marginVertical: spacing.md, textAlign: "center" },
  lineCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  lineTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  lineName: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  lineMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  lineInputs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, alignItems: "flex-end" },
  mini: { flex: 1 },
  miniLabel: { fontSize: 10, color: colors.onSurfaceSecondary, fontWeight: "600", marginBottom: 2 },
  miniInput: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, fontSize: font.base, color: colors.onSurface, textAlign: "center", borderWidth: 1, borderColor: colors.border },
  netBox: { flex: 1.2, alignItems: "flex-end" },
  netLabel: { fontSize: 10, color: colors.onSurfaceSecondary, fontWeight: "600" },
  netValue: { fontSize: font.base, fontWeight: "800", color: colors.brandPrimary, marginTop: 6 },
  error: { color: colors.error, fontWeight: "600", marginTop: spacing.md },
  gpsNote: { fontSize: font.sm, color: colors.success, fontWeight: "600", marginTop: 2 },
  taskBox: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.md, marginTop: spacing.md },
  taskHeading: { fontSize: font.lg, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  req: { color: colors.error, fontWeight: "800" },
  photoBox: { height: 120, borderRadius: radius.md, borderWidth: 2, borderColor: colors.brandPrimary, borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary, overflow: "hidden" },
  photoImg: { width: "100%", height: "100%" },
  photoHint: { color: colors.brandPrimary, fontWeight: "700", marginTop: 4 },
  optChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  optChipText: { fontWeight: "600", color: colors.onSurfaceSecondary },
  optChipTextActive: { color: colors.onBrandPrimary },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: font.base, color: colors.onSurfaceSecondary, fontWeight: "600" },
  totalValue: { fontSize: font.xxl, fontWeight: "800", color: colors.onSurface },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, height: "75%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, fontWeight: "700", color: colors.onSurface },
  pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickName: { fontSize: font.base, fontWeight: "600", color: colors.onSurface },
  pickMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
});
