import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import { api } from "./api";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes while app foreground/active

/**
 * Foreground location pinger for salesmen.
 * Sends the device location to the backend every 5 minutes while the app is open.
 * True background tracking requires a dev build with `expo-task-manager`;
 * this MVP uses foreground pings which are sufficient for Expo Go.
 */
export function useLocationPinger(token: string | null) {
  const timerRef = useRef<any>(null);
  const permRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    let mounted = true;

    async function ping() {
      if (!mounted || !token) return;
      if (permRef.current === null) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          permRef.current = status === "granted";
        } catch {
          permRef.current = false;
        }
      }
      if (!permRef.current) return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await api.postLocation(token, {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy: loc.coords.accuracy || undefined,
        });
      } catch {}
    }

    // ping immediately, then every INTERVAL_MS
    ping();
    timerRef.current = setInterval(ping, INTERVAL_MS);

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") ping();
    });

    return () => {
      mounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
      sub.remove();
    };
  }, [token]);
}

export async function getCurrentGPS(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return null;
  }
}
