// All date/time in the app is shown in India time (IST, Asia/Kolkata),
// regardless of the device or server timezone.
const TZ = "Asia/Kolkata";
const LOCALE = "en-IN";

type DTOpts = Intl.DateTimeFormatOptions;

export function fmtDateTime(iso?: string | Date, opts: DTOpts = {}): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(LOCALE, { timeZone: TZ, ...opts });
}

export function fmtDate(iso?: string | Date, opts: DTOpts = {}): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(LOCALE, { timeZone: TZ, ...opts });
}

export function fmtTime(iso?: string | Date, opts: DTOpts = {}): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(LOCALE, { timeZone: TZ, hour: "2-digit", minute: "2-digit", ...opts });
}
