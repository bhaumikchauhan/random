import { Linking, Platform } from "react-native";

export function normalizePhone(phone?: string) {
  if (!phone) return "";
  let p = phone.replace(/[^0-9]/g, "");
  if (p.length === 10) p = "91" + p; // Assume India
  return p;
}

export async function openWhatsApp(phone: string | undefined, message = "") {
  const p = normalizePhone(phone);
  if (!p) return false;
  const encoded = encodeURIComponent(message);
  const nativeUrl = `whatsapp://send?phone=${p}&text=${encoded}`;
  const webUrl = `https://wa.me/${p}?text=${encoded}`;
  try {
    const can = await Linking.canOpenURL(nativeUrl);
    if (can && Platform.OS !== "web") {
      await Linking.openURL(nativeUrl);
      return true;
    }
  } catch {}
  await Linking.openURL(webUrl);
  return true;
}

export async function callPhone(phone?: string) {
  if (!phone) return;
  const p = phone.replace(/[^0-9+]/g, "");
  await Linking.openURL(`tel:${p}`);
}

export const templates = {
  order: (shop?: string) =>
    `Hi ${shop || "there"}, hope you're doing well. Are you ready for your next order? We have some new stock and offers. Please let me know your requirement.`,
  reminder: (shop?: string, amount?: number) =>
    `Hi ${shop || "there"}, this is a friendly reminder that ₹${(amount || 0).toLocaleString("en-IN")} is pending on your account. Kindly arrange the payment at your earliest. Thank you.`,
  followup: (shop?: string) =>
    `Hi ${shop || "there"}, just following up on our last conversation. Please let me know if you'd like to place an order or need any information.`,
};

export function customerShareText(c: {
  shop_name?: string; owner_name?: string; mobile?: string; address?: string;
  gps_lat?: number; gps_lng?: number;
}) {
  const lines = [
    `*${c.shop_name || "Customer"}*`,
    c.owner_name ? `Owner: ${c.owner_name}` : "",
    c.mobile ? `Mobile: ${c.mobile}` : "",
    c.address ? `Address: ${c.address}` : "",
    (c.gps_lat && c.gps_lng)
      ? `Location: https://www.google.com/maps/search/?api=1&query=${c.gps_lat},${c.gps_lng}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function shareViaWhatsApp(message: string) {
  const encoded = encodeURIComponent(message);
  const nativeUrl = `whatsapp://send?text=${encoded}`;
  const webUrl = `https://wa.me/?text=${encoded}`;
  try {
    if (Platform.OS !== "web") {
      const can = await Linking.canOpenURL(nativeUrl);
      if (can) { await Linking.openURL(nativeUrl); return true; }
    }
  } catch {}
  await Linking.openURL(webUrl);
  return true;
}
