import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import { useAuth } from "@/src/auth";
import { api, Salesman, ImportResult, downloadImportTemplate } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";

type Picked = { uri: string; name: string; mimeType?: string; file?: any };

export default function ImportCustomers() {
  const { token } = useAuth();
  const router = useRouter();
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [file, setFile] = useState<Picked | null>(null);
  const [dupMode, setDupMode] = useState<"skip" | "update">("skip");
  const [assignTo, setAssignTo] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try { setSalesmen(await api.listSalesmen(token)); } catch (e) { console.warn(e); }
    })();
  }, [token]);

  const getTemplate = async () => {
    if (!token) return;
    setDownloading(true);
    try { const r = await downloadImportTemplate(token, "customers"); if (!r.ok) Alert.alert("Template", r.message); }
    finally { setDownloading(false); }
  };

  const pick = async () => {
    setError(null); setResult(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const a: any = res.assets[0];
      setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file });
    } catch (e: any) {
      setError(e.message || "Could not pick file");
    }
  };

  const upload = async () => {
    if (!file || !token) return;
    setUploading(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        let blob: Blob;
        if (file.file) blob = file.file;
        else blob = await (await fetch(file.uri)).blob();
        form.append("file", blob, file.name);
      } else {
        form.append("file", {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || "application/octet-stream",
        } as any);
      }
      const r = await api.importCustomers(token, form, dupMode, assignTo);
      setResult(r);
    } catch (e: any) {
      setError(e.message || "Import failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="import-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Import Customers</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color={colors.info} />
          <Text style={styles.infoText}>
            Export your Google Sheet as Excel (.xlsx) or CSV, then upload it here. Expected columns:
            {" "}Shop/Party Name, Owner/Contact Name, Mobile, Address, Area, Outstanding Amount, Remarks.
          </Text>
        </View>

        <Pressable testID="import-template" onPress={getTemplate} disabled={downloading} style={styles.templateBtn}>
          {downloading ? <ActivityIndicator color={colors.brandPrimary} /> : (
            <>
              <Ionicons name="download-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.templateText}>Download template</Text>
            </>
          )}
        </Pressable>

        <Pressable onPress={pick} testID="import-pick" style={styles.pickBox}>
          <Ionicons name={file ? "document-text" : "cloud-upload-outline"} size={28} color={colors.brandPrimary} />
          <Text style={styles.pickText}>{file ? file.name : "Tap to choose .xlsx or .csv file"}</Text>
          {file && <Text style={styles.pickHint}>Tap again to change</Text>}
        </Pressable>

        <Text style={styles.label}>If a mobile number already exists</Text>
        <View style={styles.segment}>
          {(["skip", "update"] as const).map(m => (
            <Pressable key={m} testID={`dup-${m}`} onPress={() => setDupMode(m)}
              style={[styles.segBtn, dupMode === m && styles.segBtnActive]}>
              <Text style={[styles.segText, dupMode === m && styles.segTextActive]}>
                {m === "skip" ? "Skip duplicate" : "Update existing"}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Assign imported customers to (optional)</Text>
        <View style={styles.chipsWrap}>
          <Pressable testID="assign-none" onPress={() => setAssignTo(undefined)}
            style={[styles.chip, !assignTo && styles.chipActive]}>
            <Text style={[styles.chipText, !assignTo && styles.chipTextActive]}>Unassigned</Text>
          </Pressable>
          {salesmen.map(s => (
            <Pressable key={s.id} testID={`assign-${s.id}`} onPress={() => setAssignTo(s.id)}
              style={[styles.chip, assignTo === s.id && styles.chipActive]}>
              <Text style={[styles.chipText, assignTo === s.id && styles.chipTextActive]}>{s.name}</Text>
            </Pressable>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {result && (
          <View style={styles.resultCard} testID="import-result">
            <Text style={styles.resultTitle}>Import complete</Text>
            <ResultRow label="Rows processed" value={result.total_rows} />
            <ResultRow label="Created" value={result.created} color={colors.success} />
            <ResultRow label="Updated" value={result.updated} color={colors.info} />
            <ResultRow label="Skipped" value={result.skipped} color={colors.onSurfaceSecondary} />
            {result.errors?.length > 0 && (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.errTitle}>Issues ({result.errors.length}):</Text>
                {result.errors.map((e, i) => <Text key={i} style={styles.errLine}>• {e}</Text>)}
              </View>
            )}
            <Pressable testID="import-view-customers" onPress={() => router.replace("/(admin)/customers")} style={styles.doneBtn}>
              <Text style={styles.doneText}>View Customers</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.footer}>
        <Pressable testID="import-submit" onPress={upload} disabled={!file || uploading}
          style={[styles.uploadBtn, (!file || uploading) && { opacity: 0.5 }]}>
          {uploading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.uploadText}>Import Now</Text>}
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

function ResultRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.resRow}>
      <Text style={styles.resLabel}>{label}</Text>
      <Text style={[styles.resValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, fontWeight: "700", color: colors.onSurface },
  infoCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.info + "12", borderRadius: radius.md, padding: spacing.md, alignItems: "flex-start" },
  infoText: { flex: 1, fontSize: font.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
  templateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, backgroundColor: colors.brandTertiary },
  templateText: { color: colors.brandPrimary, fontWeight: "700", fontSize: font.base },
  pickBox: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2, borderColor: colors.brandPrimary, borderStyle: "dashed", padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  pickText: { fontSize: font.base, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  pickHint: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "600", marginTop: spacing.sm },
  segment: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  segBtn: { flex: 1, paddingVertical: spacing.md, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.brandPrimary },
  segText: { fontWeight: "700", color: colors.onSurfaceSecondary },
  segTextActive: { color: colors.onBrandPrimary },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontWeight: "600", color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  error: { color: colors.error, fontWeight: "600" },
  resultCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  resultTitle: { fontSize: font.lg, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  resRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  resLabel: { fontSize: font.base, color: colors.onSurfaceSecondary },
  resValue: { fontSize: font.base, fontWeight: "800", color: colors.onSurface },
  errTitle: { fontSize: font.sm, fontWeight: "700", color: colors.error, marginBottom: 4 },
  errLine: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  doneBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  doneText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.base },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.md },
  uploadBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  uploadText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
