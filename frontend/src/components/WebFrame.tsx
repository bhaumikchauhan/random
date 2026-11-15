import { PropsWithChildren } from "react";
import { Platform, View, StyleSheet, useWindowDimensions } from "react-native";
import { colors } from "@/src/theme";

/**
 * On wide web screens, center the mobile-first app inside a clean phone-width
 * column with a subtle backdrop. On native and small screens it renders the
 * children full-bleed (no visual change).
 */
const BREAKPOINT = 600;
const PHONE_WIDTH = 440;

export function WebFrame({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();

  if (Platform.OS !== "web" || width < BREAKPOINT) {
    return <View style={styles.full}>{children}</View>;
  }

  return (
    <View style={styles.backdrop}>
      <View style={styles.phone}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0C0A09",
    padding: 24,
  },
  phone: {
    flex: 1,
    width: "100%",
    maxWidth: PHONE_WIDTH,
    maxHeight: 924,
    backgroundColor: colors.surface,
    borderRadius: 28,
    overflow: "hidden",
    // web-only elevation via boxShadow
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 24px 60px rgba(0,0,0,0.45)" } as any)
      : {}),
  },
});
