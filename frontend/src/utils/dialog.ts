import { Alert, Platform } from "react-native";

/**
 * Cross-platform confirmation. On web, RN's Alert.alert does not render
 * action buttons, so we fall back to window.confirm.
 * Resolves true if the user confirms.
 */
export function confirmDialog(
  title: string,
  message?: string,
  opts: { confirmText?: string; cancelText?: string; destructive?: boolean } = {}
): Promise<boolean> {
  const { confirmText = "OK", cancelText = "Cancel", destructive = false } = opts;
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(message ? `${title}\n\n${message}` : title);
    return Promise.resolve(!!ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: "cancel", onPress: () => resolve(false) },
      { text: confirmText, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]);
  });
}
