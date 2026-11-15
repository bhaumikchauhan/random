import { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import { useAuth } from "@/src/auth";
import { api, ImportResult, downloadImportTemplate } from "@/src/api";
import { colors, spacing, radius, font } from "@/src/theme";

type Picked = { uri: string; name: string; mimeType?: string; file?: any };

export default function ImportItems() {
  const { token } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<Picked | null>(null);
  const [dupMode, setDupMode] = useState<"skip" | "update">("skip");
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getTemplate = async () => {
    if (!token) return;
    setDownloading(true);
    try { const r = await downloadImportTemplate(token, "items"); if (!r.ok) Alert.alert("Template", r.message); }
    finally { setDownloading(false); }
  };

  const pick = async () => {
    setError(null); setResult(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
        copyToCacheDirectory: true, multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const a: any = res.assets[0];
      setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file });
    } catch (e: any) { setError(e.message || "Could not pick file"); }
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
        form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" } as any);
      }
      setResult(await api.importItems(token, form, dupMode));
    } catch (e: any) { setError(e.message || "Import failed"); }
    finally { setUploading(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="iimport-back" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Import Items</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color={colors.info} />
          <Text style={styles.infoText}>Upload Excel (.xlsx) or CSV with columns: Item Code, Item Name, Rate, Tax Rate, MRP.</Text>
        </View>

        <Pressable testID="iimport-template" onPress={getTemplate} disabled={downloading} style={styles.templateBtn}>
          {downloading ? <ActivityIndicator color={colors.brandPrimary} /> : (
            <>
              <Ionicons name="download-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.templateText}>Download template</Text>
            </>
          )}
        </Pressable>

        <Pressable onPress={pick} testID="iimport-pick" style={styles.pickBox}>
          <Ionicons name={file ? "document-text" : "cloud-upload-outline"} size={28} color={colors.brandPrimary} />
          <Text style={styles.pickText}>{file ? file.name : "Tap to choose .xlsx or .csv file"}</Text>
          {file && <Text style={styles.pickHint}>Tap again to change</Text>}
        </Pressable>

        <Text style={styles.label}>If an item code already exists</Text>
        <View style={styles.segment}>
          {(["skip", "update"] as const).map(m => (
            <Pressable key={m} testID={`idup-${m}`} onPress={() => setDupMode(m)} style={[styles.segBtn, dupMode === m && styles.segBtnActive]}>
              <Text style={[styles.segText, dupMode === m && styles.segTextActive]}>{m === "skip" ? "Skip duplicate" : "Update existing"}</Text>
            </Pressable>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {result && (
          <View style={styles.resultCard} testID="iimport-result">
            <Text style={styles.resultTitle}>Import complete</Text>
            <Row label="Rows processed" value={result.total_rows} />
            <Row label="Created" value={result.created} color={colors.success} />
            <Row label="Updated" value={result.updated} color={colors.info} />
            <Row label="Skipped" value={result.skipped} color={colors.onSurfaceSecondary} />
            <Pressable testID="iimport-view" onPress={() => router.replace("/items")} style={styles.doneBtn}>
              <Text style={styles.doneText}>View Items</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.footer}>
        <Pressable testID="iimport-submit" onPress={upload} disabled={!file || uploading} style={[styles.uploadBtn, (!file || uploading) && { opacity: 0.5 }]}>
          {uploading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.uploadText}>Import Now</Text>}
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ label, value, color }: { label: string; value: number; color?: string }) {
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
  error: { color: colors.error, fontWeight: "600" },
  resultCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  resultTitle: { fontSize: font.lg, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  resRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  resLabel: { fontSize: font.base, color: colors.onSurfaceSecondary },
  resValue: { fontSize: font.base, fontWeight: "800", color: colors.onSurface },
  doneBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  doneText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.base },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: spacing.md },
  uploadBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  uploadText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.lg },
});
