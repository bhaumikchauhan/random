import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "fmcg_token";
const USER_KEY = "fmcg_user";

export type Role = "admin" | "salesman";
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  mobile?: string;
  area?: string;
  active: boolean;
};

async function storeGet(k: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(k);
  return SecureStore.getItemAsync(k);
}
async function storeSet(k: string, v: string | null) {
  if (Platform.OS === "web") {
    if (v === null) return AsyncStorage.removeItem(k);
    return AsyncStorage.setItem(k, v);
  }
  if (v === null) return SecureStore.deleteItemAsync(k);
  return SecureStore.setItemAsync(k, v);
}

const API = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type Ctx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({
  user: null, token: null, loading: true,
  login: async () => { throw new Error("no provider"); },
  logout: async () => {},
  refreshMe: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const t = await storeGet(TOKEN_KEY);
      const u = await storeGet(USER_KEY);
      if (t && u) {
        setToken(t);
        try { setUser(JSON.parse(u)); } catch {}
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `Login failed (${res.status})`);
    await storeSet(TOKEN_KEY, body.access_token);
    await storeSet(USER_KEY, JSON.stringify(body.user));
    setToken(body.access_token);
    setUser(body.user);
    return body.user as User;
  };

  const logout = async () => {
    await storeSet(TOKEN_KEY, null);
    await storeSet(USER_KEY, null);
    setToken(null);
    setUser(null);
  };

  const refreshMe = async () => {
    if (!token) return;
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const u = await res.json();
      setUser(u);
      await storeSet(USER_KEY, JSON.stringify(u));
    }
  };

  return (
    <AuthCtx.Provider value={{ user, token, loading, login, logout, refreshMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

export async function apiFetch(
  path: string,
  opts: RequestInit = {},
  token?: string | null
): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((opts.body && !(opts.body instanceof FormData)) ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { detail: text }; }
  if (!res.ok) {
    const err: any = new Error(body.detail || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}
