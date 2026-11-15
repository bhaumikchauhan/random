import { Platform } from "react-native";
import { apiFetch } from "./auth";

export type Customer = {
  id: string;
  shop_name: string;
  customer_code?: string;
  owner_name?: string;
  mobile?: string;
  whatsapp?: string;
  gst_number?: string;
  address?: string;
  area?: string;
  city?: string;
  customer_type?: string;
  salesman_id?: string;
  salesman_name?: string;
  gps_lat?: number;
  gps_lng?: number;
  shop_photo?: string;
  visiting_card?: string;
  product_category?: string;
  brands_purchased?: string;
  customer_status?: string;
  preferred_order_day?: string;
  credit_limit?: number;
  payment_terms?: string;
  outstanding?: number;
  remarks?: string;
  route?: string;
  custom?: Record<string, any>;
  last_visit?: string;
  next_followup?: string;
  last_order_amount?: number;
  approval_status?: string;
  created_at?: string;
};

export type Visit = {
  id: string;
  customer_id: string;
  customer_name?: string;
  salesman_id: string;
  salesman_name?: string;
  visit_date: string;
  gps_lat?: number;
  gps_lng?: number;
  visit_result: string;
  order_amount?: number;
  remarks?: string;
  next_followup?: string;
  task_photo?: string;
  task_answers?: Record<string, any>;
};

export type Salesman = {
  id: string; email: string; name: string; role: "salesman";
  mobile?: string; area?: string; active: boolean; geofence_radius_km?: number;
  can_edit_customers?: boolean;
};

export type ImportResult = {
  total_rows: number; created: number; updated: number; skipped: number; errors: string[];
};

export type Route = { id: string; name: string };
export type CustomFieldType = "text" | "number" | "dropdown" | "multiselect" | "checkbox";
export type CustomField = {
  id: string; label: string; key: string; type: CustomFieldType; options: string[];
};

export type VisitQuestionType = "text" | "number" | "single" | "multi";
export type VisitQuestion = {
  id: string; label: string; type: VisitQuestionType; options: string[]; required: boolean;
};
export type VisitTaskConfig = {
  target: string; require_photo: boolean; questions: VisitQuestion[]; target_name?: string;
};

export type LocationPoint = {
  id: string; salesman_id: string; salesman_name?: string;
  lat: number; lng: number; accuracy?: number; timestamp: string;
};

export type Dashboard = {
  total_customers: number; todays_visits: number; active_salesmen: number;
  total_outstanding: number; todays_revenue: number;
  todays_shops?: number; no_order_today?: number;
  recent_visits: Visit[];
};

export type Order = {
  id: string;
  customer_id: string;
  customer_name?: string;
  salesman_id: string;
  salesman_name?: string;
  order_date: string;
  total_amount: number;
  status: string;
  remarks?: string;
};

export type LeaderRow = {
  salesman_id: string; name: string; area?: string;
  visits: number; sales: number; orders: number; active: boolean; rank: number;
};
export type LeaderboardResult = { period: string; start: string; rows: LeaderRow[] };

export type BeatStop = {
  customer_id: string; shop_name: string; owner_name?: string; area?: string;
  mobile?: string; whatsapp?: string; gps_lat?: number; gps_lng?: number;
  outstanding: number; order: number; visited: boolean;
};
export type BeatPlan = { date: string; salesman_id: string; auto: boolean; stops: BeatStop[] };

export type AttendanceRecord = {
  id: string; salesman_id: string; salesman_name?: string; date: string;
  check_in_time?: string | null; check_in_lat?: number; check_in_lng?: number; check_in_photo?: string | null;
  check_in_distance_km?: number | null; check_in_flagged?: boolean;
  check_out_time?: string | null; check_out_lat?: number; check_out_lng?: number; check_out_photo?: string | null;
  total_hours?: number | null; warning?: string | null;
};
export type AttendanceToday = { date: string; checked_in: boolean; checked_out: boolean; record: AttendanceRecord | null };
export type AttendanceListRow = { salesman_id: string; salesman_name?: string; area?: string; present: boolean; record: AttendanceRecord | null };
export type AttendanceListResult = { date: string; rows: AttendanceListRow[] };
export type AttendanceSummaryRow = { salesman_id: string; salesman_name?: string; area?: string; days_present: number; total_hours: number };
export type AttendanceSummaryResult = { month: string; rows: AttendanceSummaryRow[] };

export type Item = {
  id: string; item_code: string; item_name: string;
  rate: number; tax_rate: number; mrp: number; active: boolean; created_at?: string;
};
export type OrderLine = {
  item_id: string; item_code: string; item_name: string;
  qty: number; rate: number; tax_rate: number; discount: number; free_qty: number; mrp: number; net: number;
};
export type OrderDetailed = {
  id: string; order_number?: string; customer_id: string; customer_name?: string;
  salesman_id: string; salesman_name?: string; order_date: string;
  total_amount: number; status: string; remarks?: string; lines: OrderLine[];
  outcome?: string; gps_lat?: number; gps_lng?: number; next_followup?: string;
  task_photo?: string; task_answers?: Record<string, any>;
  no_order_reason?: string; no_order_note?: string;
};

export type BillInput = {
  customer_id: string; remarks?: string;
  lines: { item_id: string; qty: number; discount: number; free_qty: number }[];
  outcome?: string; gps_lat?: number; gps_lng?: number; next_followup?: string;
  task_photo?: string; task_answers?: Record<string, any>;
  no_order_reason?: string; no_order_note?: string;
};

export const api = {
  listCustomers: (token: string, params: { q?: string; area?: string; route?: string; customer_type?: string; status?: string; salesman_id?: string; approval?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.append(k, String(v)); });
    return apiFetch(`/api/customers?${qs}`, {}, token) as Promise<Customer[]>;
  },
  getCustomer: (token: string, id: string) =>
    apiFetch(`/api/customers/${id}`, {}, token) as Promise<Customer>,
  createCustomer: (token: string, body: Partial<Customer>) =>
    apiFetch(`/api/customers`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<Customer>,
  updateCustomer: (token: string, id: string, body: Partial<Customer>) =>
    apiFetch(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token) as Promise<Customer>,
  approveCustomer: (token: string, id: string) =>
    apiFetch(`/api/customers/${id}/approve`, { method: "PATCH" }, token) as Promise<Customer>,
  rejectCustomer: (token: string, id: string, reason: string) =>
    apiFetch(`/api/customers/${id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }, token) as Promise<Customer>,
  outstanding: (token: string) =>
    apiFetch(`/api/customers-outstanding`, {}, token) as Promise<Customer[]>,
  importCustomers: (token: string, form: FormData, duplicate_mode: "skip" | "update", salesman_id?: string) => {
    const qs = new URLSearchParams({ duplicate_mode });
    if (salesman_id) qs.append("salesman_id", salesman_id);
    return apiFetch(`/api/customers/import?${qs}`, { method: "POST", body: form }, token) as Promise<ImportResult>;
  },
  importItems: (token: string, form: FormData, duplicate_mode: "skip" | "update") =>
    apiFetch(`/api/items/import?duplicate_mode=${duplicate_mode}`, { method: "POST", body: form }, token) as Promise<ImportResult>,

  listRoutes: (token: string) => apiFetch(`/api/routes`, {}, token) as Promise<Route[]>,
  createRoute: (token: string, name: string) =>
    apiFetch(`/api/routes`, { method: "POST", body: JSON.stringify({ name }) }, token) as Promise<Route>,
  deleteRoute: (token: string, id: string) =>
    apiFetch(`/api/routes/${id}`, { method: "DELETE" }, token),

  listCustomerFields: (token: string) => apiFetch(`/api/customer-fields`, {}, token) as Promise<CustomField[]>,
  createCustomerField: (token: string, body: { label: string; type: string; options: string[] }) =>
    apiFetch(`/api/customer-fields`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<CustomField>,
  deleteCustomerField: (token: string, id: string) =>
    apiFetch(`/api/customer-fields/${id}`, { method: "DELETE" }, token),

  listVisitTasks: (token: string) => apiFetch(`/api/visit-tasks`, {}, token) as Promise<VisitTaskConfig[]>,
  upsertVisitTask: (token: string, body: VisitTaskConfig) =>
    apiFetch(`/api/visit-tasks`, { method: "PUT", body: JSON.stringify(body) }, token) as Promise<VisitTaskConfig>,
  deleteVisitTask: (token: string, target: string) =>
    apiFetch(`/api/visit-tasks/${target}`, { method: "DELETE" }, token),
  applicableVisitTask: (token: string) =>
    apiFetch(`/api/visit-tasks/applicable`, {}, token) as Promise<VisitTaskConfig | null>,

  listVisits: (token: string, params: { salesman_id?: string; customer_id?: string; date?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.append(k, String(v)); });
    return apiFetch(`/api/visits?${qs}`, {}, token) as Promise<Visit[]>;
  },
  createVisit: (token: string, body: Partial<Visit>) =>
    apiFetch(`/api/visits`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<Visit>,

  listSalesmen: (token: string) =>
    apiFetch(`/api/salesmen`, {}, token) as Promise<Salesman[]>,
  createSalesman: (token: string, body: any) =>
    apiFetch(`/api/salesmen`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<Salesman>,
  updateSalesman: (token: string, id: string, body: any) =>
    apiFetch(`/api/salesmen/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token) as Promise<Salesman>,

  postLocation: (token: string, body: { lat: number; lng: number; accuracy?: number }) =>
    apiFetch(`/api/locations`, { method: "POST", body: JSON.stringify(body) }, token),
  listLocations: (token: string, params: { salesman_id?: string; date?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.append(k, String(v)); });
    return apiFetch(`/api/locations?${qs}`, {}, token) as Promise<LocationPoint[]>;
  },
  latestLocations: (token: string) =>
    apiFetch(`/api/locations/latest`, {}, token) as Promise<LocationPoint[]>,

  dashboard: (token: string) => apiFetch(`/api/dashboard`, {}, token) as Promise<Dashboard>,

  listOrders: (token: string) => apiFetch(`/api/orders`, {}, token) as Promise<OrderDetailed[]>,
  getOrder: (token: string, id: string) => apiFetch(`/api/orders/${id}`, {}, token) as Promise<OrderDetailed>,
  createOrder: (token: string, body: BillInput) =>
    apiFetch(`/api/orders`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<OrderDetailed>,
  updateOrder: (token: string, id: string, body: BillInput) =>
    apiFetch(`/api/orders/${id}`, { method: "PUT", body: JSON.stringify(body) }, token) as Promise<OrderDetailed>,
  submitOrder: (token: string, id: string) =>
    apiFetch(`/api/orders/${id}/submit`, { method: "POST" }, token) as Promise<OrderDetailed>,
  deleteOrder: (token: string, id: string) =>
    apiFetch(`/api/orders/${id}`, { method: "DELETE" }, token),

  listItems: (token: string, q?: string) =>
    apiFetch(`/api/items${q ? `?q=${encodeURIComponent(q)}` : ""}`, {}, token) as Promise<Item[]>,
  createItem: (token: string, body: Partial<Item>) =>
    apiFetch(`/api/items`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<Item>,
  updateItem: (token: string, id: string, body: Partial<Item>) =>
    apiFetch(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token) as Promise<Item>,
  deleteItem: (token: string, id: string) =>
    apiFetch(`/api/items/${id}`, { method: "DELETE" }, token),

  leaderboard: (token: string, period: "today" | "week" | "month" = "week") =>
    apiFetch(`/api/leaderboard?period=${period}`, {}, token) as Promise<LeaderboardResult>,

  getBeatPlan: (token: string, params: { date?: string; salesman_id?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.append(k, String(v)); });
    return apiFetch(`/api/beat-plan?${qs}`, {}, token) as Promise<BeatPlan>;
  },
  setBeatPlan: (token: string, body: { date: string; customer_ids: string[]; salesman_id?: string }) =>
    apiFetch(`/api/beat-plan`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<BeatPlan>,

  attendanceToday: (token: string) =>
    apiFetch(`/api/attendance/today`, {}, token) as Promise<AttendanceToday>,
  checkIn: (token: string, body: { lat?: number; lng?: number; photo?: string }) =>
    apiFetch(`/api/attendance/check-in`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<AttendanceRecord>,
  checkOut: (token: string, body: { lat?: number; lng?: number; photo?: string }) =>
    apiFetch(`/api/attendance/check-out`, { method: "POST", body: JSON.stringify(body) }, token) as Promise<AttendanceRecord>,
  attendanceList: (token: string, params: { date?: string; salesman_id?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.append(k, String(v)); });
    return apiFetch(`/api/attendance?${qs}`, {}, token) as Promise<AttendanceListResult>;
  },
  attendanceSummary: (token: string, month?: string) =>
    apiFetch(`/api/attendance/summary${month ? `?month=${month}` : ""}`, {}, token) as Promise<AttendanceSummaryResult>,

  uploadImage: async (token: string, uri: string, name = "photo.jpg", type = "image/jpeg") => {
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      form.append("file", blob, name);
    } else {
      // @ts-ignore RN FormData signature
      form.append("file", { uri, name, type } as any);
    }
    return apiFetch(`/api/upload`, { method: "POST", body: form }, token) as Promise<{ path: string }>;
  },
};

export function fileUrl(path?: string) {
  if (!path) return undefined;
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  return `${base}/api/files/${path}`;
}

export async function downloadAttendanceSheet(token: string, month?: string): Promise<{ ok: boolean; message: string }> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  const url = `${base}/api/attendance/export${month ? `?month=${month}` : ""}`;
  const filename = `attendance_${month || "current"}.xlsx`;

  if (Platform.OS === "web") {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { ok: false, message: "Download failed" };
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
      return { ok: true, message: "Downloaded" };
    } catch (e: any) {
      return { ok: false, message: e.message || "Download failed" };
    }
  }

  // Native: download to cache then open the share sheet
  const FileSystem = require("expo-file-system/legacy");
  const Sharing = require("expo-sharing");
  try {
    const target = FileSystem.cacheDirectory + filename;
    const { uri, status } = await FileSystem.downloadAsync(url, target, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status !== 200) return { ok: false, message: "Download failed" };
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dialogTitle: "Attendance sheet",
      });
    }
    return { ok: true, message: "Sheet ready" };
  } catch (e: any) {
    return { ok: false, message: e.message || "Download failed" };
  }
}

export async function downloadImportTemplate(token: string, kind: "customers" | "items"): Promise<{ ok: boolean; message: string }> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  const url = `${base}/api/import-templates/${kind}`;
  const filename = `${kind === "customers" ? "customer" : "item"}_import_template.xlsx`;

  if (Platform.OS === "web") {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { ok: false, message: "Download failed" };
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
      return { ok: true, message: "Downloaded" };
    } catch (e: any) {
      return { ok: false, message: e.message || "Download failed" };
    }
  }

  const FileSystem = require("expo-file-system/legacy");
  const Sharing = require("expo-sharing");
  try {
    const target = FileSystem.cacheDirectory + filename;
    const { uri, status } = await FileSystem.downloadAsync(url, target, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status !== 200) return { ok: false, message: "Download failed" };
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dialogTitle: "Import template",
      });
    }
    return { ok: true, message: "Template ready" };
  } catch (e: any) {
    return { ok: false, message: e.message || "Download failed" };
  }
}

export async function downloadBillsSheet(token: string, fromDate?: string, toDate?: string): Promise<{ ok: boolean; message: string }> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  const qs = new URLSearchParams();
  if (fromDate) qs.append("from_date", fromDate);
  if (toDate) qs.append("to_date", toDate);
  const url = `${base}/api/orders/export${qs.toString() ? `?${qs}` : ""}`;
  const filename = "bills.xlsx";

  if (Platform.OS === "web") {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { ok: false, message: "Download failed" };
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
      return { ok: true, message: "Downloaded" };
    } catch (e: any) {
      return { ok: false, message: e.message || "Download failed" };
    }
  }

  const FileSystem = require("expo-file-system/legacy");
  const Sharing = require("expo-sharing");
  try {
    const target = FileSystem.cacheDirectory + filename;
    const { uri, status } = await FileSystem.downloadAsync(url, target, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status !== 200) return { ok: false, message: "Download failed" };
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dialogTitle: "Bills export",
      });
    }
    return { ok: true, message: "Sheet ready" };
  } catch (e: any) {
    return { ok: false, message: e.message || "Download failed" };
  }
}
