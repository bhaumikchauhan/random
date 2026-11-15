import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Customer, CustomField, fileUrl } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { formatCurrency, EmptyState } from "@/src/components/ui";
import { openWhatsApp, callPhone, templates, shareViaWhatsApp, customerShareText } from "@/src/whatsapp";
import { fmtDateTime } from "@/src/utils/datetime";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const router = useRouter();
  const [c, setC] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  const load = async () => {
    if (!token || !id) return;
    try {
      const [cust, allBills, fields] = await Promise.all([
        api.getCustomer(token, id),
        api.listOrders(token),
        api.listCustomerFields(token),
      ]);
      setC(cust);
      setVisits(allBills.filter(o => o.customer_id === id).map(o => ({
        id: o.id, visit_date: o.order_date, visit_result: o.outcome || "Order",
        remarks: o.remarks, order_amount: o.total_amount, task_photo: o.task_photo, task_answers: o.task_answers,
      })));
      setCustomFields(fields);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [token, id]));

  if (loading || !c) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  const photo = fileUrl(c.shop_photo);
  const isPending = (c.approval_status || "approved") === "pending";
  const isSalesman = user?.role === "salesman";
  const canEdit = !(isSalesman && !isPending); // salesman can edit only while pending

  const approve = async () => {
    if (!token) return;
    setApproving(true);
    try {
      const updated = await api.approveCustomer(token, c.id);
      setC(updated);
    } catch (e) { console.warn(e); }
    finally { setApproving(false); }
  };

  const openMap = () => {
    if (c.gps_lat && c.gps_lng) {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${c.gps_lat},${c.gps_lng}`);
    }
  };

  const share = () => {
    shareViaWhatsApp(customerShareText({
      shop_name: c.shop_name, owner_name: c.owner_name, mobile: c.mobile,
      address: c.address, gps_lat: c.gps_lat, gps_lng: c.gps_lng,
    }));
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.banner}>
          {photo ? (
            <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceInverse }]} />
          )}
          <LinearGradient colors={["rgba(0,0,0,0.2)", "rgba(28,25,23,0.85)"]} style={StyleSheet.absoluteFill} />
          <SafeAreaView edges={["top"]} style={styles.bannerTop}>
            <Pressable onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
              <Ionicons name="chevron-back" size={24} color={colors.onSurfaceInverse} />
            </Pressable>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Pressable onPress={share} style={styles.backBtn} testID="share-customer-btn">
                <Ionicons name="share-social-outline" size={20} color={colors.onSurfaceInverse} />
              </Pressable>
              {canEdit && (
                <Pressable onPress={() => router.push(`/customer/edit/${c.id}`)} style={styles.backBtn} testID="edit-customer-btn">
                  <Ionicons name="create-outline" size={22} color={colors.onSurfaceInverse} />
                </Pressable>
              )}
            </View>
          </SafeAreaView>
          <View style={styles.bannerText}>
            {isPending && (
              <View style={styles.pendingBadge} testID="pending-badge">
                <Ionicons name="time" size={12} color={colors.onWarning} />
                <Text style={styles.pendingText}>Pending approval</Text>
              </View>
            )}
            <Text style={styles.shopName}>{c.shop_name}</Text>
            <Text style={styles.shopSub}>{c.customer_code ? `${c.customer_code} • ` : ""}{c.owner_name}{c.area ? ` • ${c.area}` : ""}</Text>
          </View>
        </View>

        {user?.role === "admin" && isPending && (
          <Pressable testID="approve-customer-btn" onPress={approve} disabled={approving} style={styles.approveBar}>
            {approving ? <ActivityIndicator color={colors.onSuccess} /> : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={colors.onSuccess} />
                <Text style={styles.approveText}>Approve this customer</Text>
              </>
            )}
          </Pressable>
        )}

        <View style={styles.actionsRow}>
          <QuickAction icon="logo-whatsapp" label="WhatsApp" color="#25D366" testID="detail-whatsapp"
            onPress={() => openWhatsApp(c.whatsapp || c.mobile, templates.order(c.shop_name))} />
          <QuickAction icon="call" label="Call" color={colors.brandPrimary} testID="detail-call"
            onPress={() => callPhone(c.mobile)} />
          <QuickAction icon="location" label="Map" color={colors.warning} testID="detail-map"
            onPress={openMap} disabled={!c.gps_lat} />
          <QuickAction icon="share-social" label="Share" color={colors.info} testID="detail-share"
            onPress={share} />
        </View>

        {!!(c.outstanding && c.outstanding > 0) && (
          <View style={styles.outstandingCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.outLabel}>Outstanding Amount</Text>
              <Text style={styles.outValue}>{formatCurrency(c.outstanding)}</Text>
            </View>
            <Pressable testID="remind-btn" style={styles.remindBtn}
              onPress={() => openWhatsApp(c.whatsapp || c.mobile, templates.reminder(c.shop_name, c.outstanding))}>
              <Ionicons name="logo-whatsapp" size={18} color={colors.onError} />
              <Text style={styles.remindText}>Send reminder</Text>
            </Pressable>
          </View>
        )}

        <Section title="Contact">
          <Detail label="Mobile" value={c.mobile} />
          <Detail label="WhatsApp" value={c.whatsapp} />
          <Detail label="Address" value={c.address} />
          <Detail label="City" value={c.city} />
          <Detail label="GST Number" value={c.gst_number} />
        </Section>

        <Section title="Business">
          <Detail label="Customer ID" value={c.customer_code} />
          <Detail label="Customer Type" value={c.customer_type} />
          <Detail label="Route" value={c.route} />
          <Detail label="Product Category" value={c.product_category} />
          <Detail label="Brands Purchased" value={c.brands_purchased} />
          <Detail label="Preferred Order Day" value={c.preferred_order_day} />
          <Detail label="Credit Limit" value={c.credit_limit ? formatCurrency(c.credit_limit) : undefined} />
          <Detail label="Payment Terms" value={c.payment_terms} />
          <Detail label="Salesman" value={c.salesman_name} />
          <Detail label="Status" value={c.customer_status} />
        </Section>

        {customFields.some(f => { const v = c.custom?.[f.key]; return v != null && v !== "" && !(Array.isArray(v) && v.length === 0); }) && (
          <Section title="Additional Details">
            {customFields.map(f => {
              const v = c.custom?.[f.key];
              let display: string | undefined;
              if (v == null || v === "") display = undefined;
              else if (f.type === "checkbox") display = v ? "Yes" : "No";
              else if (Array.isArray(v)) display = v.length ? v.join(", ") : undefined;
              else display = String(v);
              return <Detail key={f.id} label={f.label} value={display} />;
            })}
          </Section>
        )}

        {!!c.remarks && (
          <Section title="Remarks">
            <Text style={styles.remarks}>{c.remarks}</Text>
          </Section>
        )}

        <Section title={`Bill History (${visits.length})`}>
          {visits.length === 0 ? (
            <EmptyState title="No visits" subtitle="No visits logged for this shop yet." icon="clipboard-outline" />
          ) : visits.map(v => (
            <View key={v.id} style={styles.visitItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.visitDate}>{fmtDateTime(v.visit_date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                {!!v.remarks && <Text style={styles.visitRemark}>{v.remarks}</Text>}
                {!!v.order_amount && v.order_amount > 0 && <Text style={styles.visitOrder}>Order: {formatCurrency(v.order_amount)}</Text>}
                {v.task_answers && Object.keys(v.task_answers).length > 0 && Object.entries(v.task_answers).map(([k, val]) => (
                  <Text key={k} style={styles.visitAnswer}>• {k}: {Array.isArray(val) ? val.join(", ") : String(val)}</Text>
                ))}
                {!!v.task_photo && <Image source={{ uri: fileUrl(v.task_photo) }} style={styles.visitPhoto} />}
              </View>
              <View style={styles.miniPill}><Text style={styles.miniPillText}>{v.visit_result}</Text></View>
            </View>
          ))}
        </Section>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.footer}>
        <Pressable testID="log-visit-btn" style={styles.logBtn}
          onPress={() => router.push(`/order/new?customer_id=${c.id}`)}>
          <Ionicons name="add-circle" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.logBtnText}>New Bill</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

function QuickAction({ icon, label, color, onPress, disabled, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={[styles.qa, disabled && { opacity: 0.4 }]}>
      <View style={[styles.qaIcon, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.qaLabel}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  banner: { height: 220, justifyContent: "flex-end" },
  bannerTop: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", padding: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  bannerText: { padding: spacing.lg },
  pendingBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", backgroundColor: colors.warning, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, marginBottom: spacing.sm },
  pendingText: { color: colors.onWarning, fontSize: font.sm, fontWeight: "700" },
  approveBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.success, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md },
  approveText: { color: colors.onSuccess, fontWeight: "700", fontSize: font.base },
  shopName: { color: colors.onSurfaceInverse, fontSize: font.xxl, fontWeight: "800" },
  shopSub: { color: colors.onSurfaceInverse, fontSize: font.base, opacity: 0.9, marginTop: 2 },
  actionsRow: { flexDirection: "row", gap: spacing.md, padding: spacing.lg },
  qa: { flex: 1, alignItems: "center", gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border },
  qaIcon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  qaLabel: { fontSize: font.sm, fontWeight: "600", color: colors.onSurface },
  outstandingCard: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.lg, backgroundColor: "#FEE2E2", borderRadius: radius.md, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.md },
  outLabel: { color: colors.error, fontSize: font.sm, fontWeight: "600" },
  outValue: { color: colors.error, fontSize: font.xl, fontWeight: "800" },
  remindBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  remindText: { color: colors.onError, fontWeight: "700", fontSize: font.sm },
  section: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  sectionCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  detailLabel: { color: colors.onSurfaceSecondary, fontSize: font.base },
  detailValue: { color: colors.onSurface, fontSize: font.base, fontWeight: "600", flex: 1, textAlign: "right" },
  remarks: { color: colors.onSurface, fontSize: font.base, lineHeight: 20 },
  visitItem: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  visitDate: { fontSize: font.base, fontWeight: "600", color: colors.onSurface },
  visitRemark: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  visitOrder: { fontSize: font.sm, color: colors.brandPrimary, fontWeight: "700", marginTop: 2 },
  visitAnswer: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  visitPhoto: { width: 90, height: 90, borderRadius: radius.sm, marginTop: spacing.xs },
  miniPill: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  miniPillText: { fontSize: font.sm, fontWeight: "700", color: colors.onSurfaceSecondary },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.md },
  logBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md },
  logBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
