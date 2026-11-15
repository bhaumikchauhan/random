import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator,
  Platform, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

import { useAuth } from "@/src/auth";
import { api, Customer, Salesman, Route, CustomField, fileUrl } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";

type Props = { customerId?: string };

const STATUS = ["Active", "Inactive"];
const TYPES = ["Retailer", "Wholesaler", "Distributor"];

export default function CustomerForm({ customerId }: Props) {
  const { token, user } = useAuth();
  const router = useRouter();
  const isEdit = !!customerId;

  const [form, setForm] = useState<Partial<Customer>>({ customer_status: "Active", customer_type: "Retailer" });
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<null | "shop" | "card">(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Customer, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setCustom = (key: string, v: any) => setForm(f => ({ ...f, custom: { ...(f.custom || {}), [key]: v } }));

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const [rts, fields] = await Promise.all([api.listRoutes(token), api.listCustomerFields(token)]);
        setRoutes(rts);
        setCustomFields(fields);
        if (user?.role === "admin") {
          const s = await api.listSalesmen(token);
          setSalesmen(s);
        }
        if (isEdit && customerId) {
          const c = await api.getCustomer(token, customerId);
          setForm(c);
        }
      } catch (e) { console.warn(e); }
      finally { setLoading(false); }
    })();
  }, [token, customerId]);

  const pickImage = async (which: "shop" | "card") => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        setError("Photo access blocked. Enable it in Settings.");
      }
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      allowsEditing: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    await doUpload(which, res.assets[0].uri);
  };

  const takePhoto = async (which: "shop" | "card") => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) setError("Camera access blocked. Enable it in Settings.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true });
    if (res.canceled || !res.assets?.[0]) return;
    await doUpload(which, res.assets[0].uri);
  };

  const doUpload = async (which: "shop" | "card", uri: string) => {
    if (!token) return;
    setUploading(which);
    try {
      const r = await api.uploadImage(token, uri);
      set(which === "shop" ? "shop_photo" : "visiting_card", r.path);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const fetchGPS = async () => {
    setGpsBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError("Location permission denied. Enable it to capture GPS.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      set("gps_lat", loc.coords.latitude);
      set("gps_lng", loc.coords.longitude);
    } catch (e) {
      setError("Could not fetch location");
    } finally {
      setGpsBusy(false);
    }
  };

  const save = async () => {
    setError(null);
    if (!form.shop_name?.trim()) {
      setError("Shop name is required");
      return;
    }
    if (!token) return;
    setSaving(true);
    try {
      if (isEdit && customerId) {
        await api.updateCustomer(token, customerId, form);
        router.back();
      } else {
        const created = await api.createCustomer(token, form);
        router.replace(`/customer/${created.id}`);
      }
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <Pressable onPress={() => router.back()} testID="form-back-btn" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEdit ? "Edit Customer" : "Add Customer"}</Text>
        <View style={{ width: 40 }} />
      </SafeAreaView>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        bottomOffset={90}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.photoRow}>
          <PhotoBox label="Shop Photo" uri={fileUrl(form.shop_photo)} busy={uploading === "shop"}
            onLibrary={() => pickImage("shop")} onCamera={() => takePhoto("shop")} testID="shop-photo" />
          <PhotoBox label="Visiting Card" uri={fileUrl(form.visiting_card)} busy={uploading === "card"}
            onLibrary={() => pickImage("card")} onCamera={() => takePhoto("card")} testID="card-photo" />
        </View>

        <Field label="Shop Name *" value={form.shop_name} onChange={v => set("shop_name", v)} testID="input-shop-name" />
        <Field label="Owner Name" value={form.owner_name} onChange={v => set("owner_name", v)} testID="input-owner-name" />
        <Field label="Mobile" value={form.mobile} onChange={v => set("mobile", v)} keyboardType="phone-pad" testID="input-mobile" />
        <Field label="WhatsApp" value={form.whatsapp} onChange={v => set("whatsapp", v)} keyboardType="phone-pad" testID="input-whatsapp" />
        <Field label="GST Number" value={form.gst_number} onChange={v => set("gst_number", v)} testID="input-gst" />
        <Field label="Address" value={form.address} onChange={v => set("address", v)} multiline testID="input-address" />
        <Field label="Area" value={form.area} onChange={v => set("area", v)} testID="input-area" />
        <Field label="City" value={form.city} onChange={v => set("city", v)} testID="input-city" />

        {routes.length > 0 && (
          <>
            <Text style={styles.label}>Route</Text>
            <View style={styles.chipWrap}>
              {routes.map(r => (
                <Pressable key={r.id} testID={`route-${r.id}`} onPress={() => set("route", form.route === r.name ? undefined : r.name)}
                  style={[styles.chip, form.route === r.name && styles.chipActive]}>
                  <Text style={[styles.chipText, form.route === r.name && styles.chipTextActive]}>{r.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>Customer Type</Text>
        <SegmentRow options={TYPES} value={form.customer_type} onChange={v => set("customer_type", v)} prefix="type" />

        <Text style={styles.label}>Status</Text>
        <SegmentRow options={STATUS} value={form.customer_status} onChange={v => set("customer_status", v)} prefix="status" />

        {user?.role === "admin" && salesmen.length > 0 && (
          <>
            <Text style={styles.label}>Assign Salesman</Text>
            <View style={styles.chipWrap}>
              {salesmen.map(s => (
                <Pressable key={s.id} testID={`assign-${s.id}`} onPress={() => set("salesman_id", s.id)}
                  style={[styles.chip, form.salesman_id === s.id && styles.chipActive]}>
                  <Text style={[styles.chipText, form.salesman_id === s.id && styles.chipTextActive]}>{s.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Field label="Product Category" value={form.product_category} onChange={v => set("product_category", v)} testID="input-category" />
        <Field label="Brands Purchased" value={form.brands_purchased} onChange={v => set("brands_purchased", v)} testID="input-brands" />
        <Field label="Preferred Order Day" value={form.preferred_order_day} onChange={v => set("preferred_order_day", v)} testID="input-order-day" />
        <Field label="Payment Terms" value={form.payment_terms} onChange={v => set("payment_terms", v)} testID="input-terms" />
        <Field label="Credit Limit" value={form.credit_limit != null ? String(form.credit_limit) : ""} onChange={v => set("credit_limit", Number(v) || 0)} keyboardType="numeric" testID="input-credit" />
        <Field label="Outstanding" value={form.outstanding != null ? String(form.outstanding) : ""} onChange={v => set("outstanding", Number(v) || 0)} keyboardType="numeric" testID="input-outstanding" />
        <Field label="Remarks" value={form.remarks} onChange={v => set("remarks", v)} multiline testID="input-remarks" />

        {customFields.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Additional Details</Text>
            {customFields.map(f => {
              const val = form.custom?.[f.key];
              if (f.type === "dropdown") {
                return (
                  <View key={f.id} style={{ marginBottom: spacing.sm }}>
                    <Text style={styles.label}>{f.label}</Text>
                    <View style={styles.chipWrap}>
                      {f.options.map(opt => (
                        <Pressable key={opt} testID={`cf-${f.key}-${opt}`} onPress={() => setCustom(f.key, val === opt ? undefined : opt)}
                          style={[styles.chip, val === opt && styles.chipActive]}>
                          <Text style={[styles.chipText, val === opt && styles.chipTextActive]}>{opt}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              }
              if (f.type === "multiselect") {
                const arr: string[] = Array.isArray(val) ? val : [];
                const toggleOpt = (opt: string) => {
                  const next = arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt];
                  setCustom(f.key, next);
                };
                return (
                  <View key={f.id} style={{ marginBottom: spacing.sm }}>
                    <Text style={styles.label}>{f.label}</Text>
                    <View style={styles.chipWrap}>
                      {f.options.map(opt => {
                        const on = arr.includes(opt);
                        return (
                          <Pressable key={opt} testID={`cf-${f.key}-${opt}`} onPress={() => toggleOpt(opt)}
                            style={[styles.chip, on && styles.chipActive]}>
                            <Text style={[styles.chipText, on && styles.chipTextActive]}>{on ? "✓ " : ""}{opt}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              }
              if (f.type === "checkbox") {
                const on = val === true;
                return (
                  <Pressable key={f.id} testID={`cf-${f.key}`} onPress={() => setCustom(f.key, !on)} style={styles.checkRow}>
                    <Ionicons name={on ? "checkbox" : "square-outline"} size={24} color={on ? colors.brandPrimary : colors.onSurfaceTertiary} />
                    <Text style={styles.checkLabel}>{f.label}</Text>
                  </Pressable>
                );
              }
              return (
                <Field key={f.id} label={f.label}
                  value={val != null ? String(val) : ""}
                  onChange={(v: string) => setCustom(f.key, f.type === "number" ? (v === "" ? undefined : Number(v) || 0) : v)}
                  keyboardType={f.type === "number" ? "numeric" : undefined}
                  testID={`cf-${f.key}`} />
              );
            })}
          </>
        )}

        <Text style={styles.label}>GPS Location</Text>
        <Pressable onPress={fetchGPS} testID="fetch-gps-btn" style={styles.gpsBtn}>
          {gpsBusy ? <ActivityIndicator color={colors.brandPrimary} /> : (
            <>
              <Ionicons name="locate" size={18} color={colors.brandPrimary} />
              <Text style={styles.gpsText}>
                {form.gps_lat ? `${form.gps_lat.toFixed(5)}, ${form.gps_lng?.toFixed(5)}` : "Fetch Current Location"}
              </Text>
            </>
          )}
        </Pressable>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            {(error.includes("Settings") ) && (
              <Pressable onPress={() => Linking.openSettings()}><Text style={styles.settingsLink}>Open Settings</Text></Pressable>
            )}
          </View>
        )}
      </KeyboardAwareScrollView>

      <KeyboardStickyView>
        <SafeAreaView edges={["bottom"]} style={styles.footer}>
          <Pressable testID="save-customer-btn" onPress={save} disabled={saving} style={styles.saveBtn}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> :
              <Text style={styles.saveText}>{isEdit ? "Save Changes" : "Save Customer"}</Text>}
          </Pressable>
        </SafeAreaView>
      </KeyboardStickyView>
    </View>
  );
}

function Field({ label, value, onChange, keyboardType, multiline, testID }: any) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value || ""}
        onChangeText={onChange}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholderTextColor={colors.onSurfaceTertiary}
        style={[styles.input, multiline && { height: 72, textAlignVertical: "top" }]}
      />
    </View>
  );
}

function SegmentRow({ options, value, onChange, prefix }: any) {
  return (
    <View style={styles.segment}>
      {options.map((o: string) => (
        <Pressable key={o} testID={`${prefix}-${o}`} onPress={() => onChange(o)}
          style={[styles.segItem, value === o && styles.segItemActive]}>
          <Text style={[styles.segText, value === o && styles.segTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PhotoBox({ label, uri, busy, onLibrary, onCamera, testID }: any) {
  return (
    <View style={styles.photoBox}>
      <Pressable testID={`${testID}-preview`} onPress={onLibrary} style={styles.photoPreview}>
        {busy ? <ActivityIndicator color={colors.brandPrimary} /> :
          uri ? <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" /> :
            <Ionicons name="image-outline" size={28} color={colors.onSurfaceTertiary} />}
      </Pressable>
      <Text style={styles.photoLabel}>{label}</Text>
      <View style={styles.photoActions}>
        <Pressable testID={`${testID}-camera`} onPress={onCamera} style={styles.photoBtn}>
          <Ionicons name="camera" size={16} color={colors.brandPrimary} />
        </Pressable>
        <Pressable testID={`${testID}-library`} onPress={onLibrary} style={styles.photoBtn}>
          <Ionicons name="images" size={16} color={colors.brandPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  photoRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  photoBox: { flex: 1, alignItems: "center", gap: spacing.xs },
  photoPreview: { width: "100%", height: 110, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600" },
  photoActions: { flexDirection: "row", gap: spacing.sm },
  photoBtn: { width: 36, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600", marginBottom: spacing.xs, marginTop: spacing.xs },
  sectionHeading: { fontSize: font.lg, fontWeight: "800", color: colors.onSurface, marginTop: spacing.lg, marginBottom: spacing.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  checkLabel: { fontSize: font.base, color: colors.onSurface, fontWeight: "600" },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.base, color: colors.onSurface },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: 3, marginBottom: spacing.sm },
  segItem: { flex: 1, paddingVertical: spacing.sm, alignItems: "center", borderRadius: radius.sm },
  segItemActive: { backgroundColor: colors.surface },
  segText: { fontSize: font.base, color: colors.onSurfaceSecondary, fontWeight: "600" },
  segTextActive: { color: colors.brandPrimary },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, height: 36, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  chipText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
  chipTextActive: { color: colors.onBrandTertiary },
  gpsBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, justifyContent: "center", marginBottom: spacing.md },
  gpsText: { color: colors.brandPrimary, fontWeight: "600", fontSize: font.base },
  errorBox: { backgroundColor: "#FEE2E2", borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  errorText: { color: colors.error, fontWeight: "600" },
  settingsLink: { color: colors.error, fontWeight: "700", textDecorationLine: "underline" },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.md },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
