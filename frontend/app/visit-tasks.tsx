import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Switch, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { api, Salesman, VisitTaskConfig, VisitQuestion, VisitQuestionType } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";
import { confirmDialog } from "@/src/utils/dialog";

const QTYPES: { key: VisitQuestionType; label: string }[] = [
  { key: "text", label: "Text" },
  { key: "number", label: "Number" },
  { key: "single", label: "Single-select" },
  { key: "multi", label: "Multi-select" },
];

const newQ = (): VisitQuestion => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label: "", type: "single", options: [], required: false });

export default function VisitTasks() {
  const { token } = useAuth();
  const router = useRouter();
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [configs, setConfigs] = useState<VisitTaskConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("all");
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [questions, setQuestions] = useState<VisitQuestion[]>([]);
  const [optsText, setOptsText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const [sm, cfgs] = await Promise.all([api.listSalesmen(token), api.listVisitTasks(token)]);
      setSalesmen(sm);
      setConfigs(cfgs);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [token]);

  // Load config for the selected target into the editor
  useEffect(() => {
    const cfg = configs.find(c => c.target === target);
    if (cfg) {
      setRequirePhoto(cfg.require_photo);
      setQuestions(cfg.questions.map(q => ({ ...q })));
      const ot: Record<string, string> = {};
      cfg.questions.forEach(q => { ot[q.id] = (q.options || []).join(", "); });
      setOptsText(ot);
    } else {
      setRequirePhoto(false);
      setQuestions([]);
      setOptsText({});
    }
  }, [target, configs]);

  const setQ = (id: string, patch: Partial<VisitQuestion>) =>
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q));

  const save = async () => {
    if (!token) return;
    const qs = questions
      .filter(q => q.label.trim())
      .map(q => ({
        ...q,
        label: q.label.trim(),
        options: (q.type === "single" || q.type === "multi")
          ? (optsText[q.id] || "").split(",").map(o => o.trim()).filter(Boolean)
          : [],
      }));
    for (const q of qs) {
      if ((q.type === "single" || q.type === "multi") && q.options.length === 0) {
        Alert.alert("Options needed", `Add options for "${q.label}"`); return;
      }
    }
    setSaving(true);
    try {
      await api.upsertVisitTask(token, { target, require_photo: requirePhoto, questions: qs });
      await load();
      Alert.alert("Saved", "Visit tasks updated.");
    } catch (e: any) { Alert.alert("Error", e.message || "Could not save"); }
    finally { setSaving(false); }
  };

  const removeConfig = async (t: string) => {
    const ok = await confirmDialog("Delete", "Remove this visit checklist?", { confirmText: "Delete", destructive: true });
    if (!ok || !token) return;
    try { await api.deleteVisitTask(token, t); await load(); if (target === t) setTarget("all"); }
    catch (e) { console.warn(e); }
  };

  const targetName = (t: string) => t === "all" ? "All salesmen" : (salesmen.find(s => s.id === t)?.name || t);

  if (loading) {
    return <SafeAreaView style={styles.root}><View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>;
  }

  const targetChips = [{ id: "all", name: "All salesmen" }, ...salesmen.map(s => ({ id: s.id, name: s.name }))];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="vt-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Bill Tasks</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView bottomOffset={20} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 60 }}>
        <Text style={styles.hint}>Set what a salesman must do on every bill — take a photo and answer your questions. Required items must be completed before the bill can be saved.</Text>

        <Text style={styles.label}>Applies to</Text>
        <View style={styles.chipWrap}>
          {targetChips.map(t => (
            <Pressable key={t.id} testID={`vt-target-${t.id}`} onPress={() => setTarget(t.id)}
              style={[styles.chip, target === t.id && styles.chipActive]}>
              <Text style={[styles.chipText, target === t.id && styles.chipTextActive]}>{t.name}{configs.some(c => c.target === t.id) ? " ✓" : ""}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.photoRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.photoLabel}>Photo required on visit</Text>
            <Text style={styles.photoSub}>Salesman must attach a photo</Text>
          </View>
          <Switch testID="vt-require-photo" value={requirePhoto} onValueChange={setRequirePhoto}
            trackColor={{ true: colors.brandSecondary, false: colors.surfaceTertiary }} />
        </View>

        <Text style={styles.sectionHeading}>Questions ({questions.length})</Text>
        {questions.map((q, i) => (
          <View key={q.id} style={styles.qCard} testID={`vt-q-${i}`}>
            <View style={styles.qTop}>
              <Text style={styles.qNum}>Q{i + 1}</Text>
              <Pressable testID={`vt-q-del-${i}`} onPress={() => setQuestions(qs => qs.filter(x => x.id !== q.id))} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
            <TextInput testID={`vt-q-label-${i}`} value={q.label} onChangeText={v => setQ(q.id, { label: v })}
              placeholder="Question (e.g. Is the shop open?)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <View style={styles.qTypeRow}>
              {QTYPES.map(t => (
                <Pressable key={t.key} testID={`vt-q-type-${i}-${t.key}`} onPress={() => setQ(q.id, { type: t.key })}
                  style={[styles.qTypeBtn, q.type === t.key && styles.qTypeBtnActive]}>
                  <Text style={[styles.qTypeText, q.type === t.key && styles.qTypeTextActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            {(q.type === "single" || q.type === "multi") && (
              <TextInput testID={`vt-q-opts-${i}`} value={optsText[q.id] || ""} onChangeText={v => setOptsText(o => ({ ...o, [q.id]: v }))}
                placeholder="Options (comma separated)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            )}
            <View style={styles.reqRow}>
              <Text style={styles.reqLabel}>Required</Text>
              <Switch testID={`vt-q-req-${i}`} value={q.required} onValueChange={v => setQ(q.id, { required: v })}
                trackColor={{ true: colors.brandSecondary, false: colors.surfaceTertiary }} />
            </View>
          </View>
        ))}

        <Pressable testID="vt-add-q" onPress={() => setQuestions(qs => [...qs, newQ()])} style={styles.addQBtn}>
          <Ionicons name="add" size={20} color={colors.brandPrimary} />
          <Text style={styles.addQText}>Add question</Text>
        </Pressable>

        <Pressable testID="vt-save" onPress={save} disabled={saving} style={styles.saveBtn}>
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save checklist for {targetName(target)}</Text>}
        </Pressable>

        {configs.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Existing checklists</Text>
            {configs.map(c => (
              <View key={c.target} style={styles.cfgRow} testID={`vt-cfg-${c.target}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cfgName}>{c.target_name || targetName(c.target)}</Text>
                  <Text style={styles.cfgMeta}>{c.require_photo ? "Photo • " : ""}{c.questions.length} question(s)</Text>
                </View>
                <Pressable testID={`vt-cfg-del-${c.target}`} onPress={() => removeConfig(c.target)} hitSlop={8} style={styles.delBtn}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </View>
            ))}
          </>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  hint: { fontSize: font.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600" },
  sectionHeading: { fontSize: font.lg, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontWeight: "600", color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  photoRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  photoLabel: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  photoSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  qCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  qTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  qNum: { fontSize: font.sm, fontWeight: "800", color: colors.brandPrimary },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.base, color: colors.onSurface },
  qTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  qTypeBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  qTypeBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  qTypeText: { fontSize: font.sm, fontWeight: "600", color: colors.onSurfaceSecondary },
  qTypeTextActive: { color: colors.onBrandPrimary },
  reqRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reqLabel: { fontSize: font.base, color: colors.onSurface, fontWeight: "600" },
  addQBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: "dashed", borderRadius: radius.md, paddingVertical: spacing.md, backgroundColor: colors.brandTertiary },
  addQText: { color: colors.brandPrimary, fontWeight: "700" },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  saveText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.base },
  cfgRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cfgName: { fontSize: font.base, fontWeight: "700", color: colors.onSurface },
  cfgMeta: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  delBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
});
