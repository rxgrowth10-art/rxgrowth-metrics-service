const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MDY_DATE = /^(\d{2})-(\d{2})-(\d{4})$/;
const ISO_MIDNIGHT_Z = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.\d{1,3})?Z$/i;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

/** Epoch milliseconds, epoch seconds, or an ISO timestamp. YYYY-MM-DD is not an instant. */
export function parseInstant(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return instantFromEpoch(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || isIsoDate(trimmed)) return null;
  if (/^\d+$/.test(trimmed)) return instantFromEpoch(Number(trimmed));
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Calendar day for a DATE custom field stored on a contact.
 * The result is the calendar Y-M-D only. Nothing here is converted into the tenant timezone.
 * `YYYY-MM-DD` stays that day. `MM-DD-YYYY` is the legacy formatter.
 * An ISO timestamp, including the midnight UTC string contact search returns
 * (`2026-10-21T00:00:00.000Z`), uses that instant's UTC year-month-day.
 * Epoch milliseconds, as a number or a numeric string, do too.
 */
export function parseStoredDate(value: unknown, _timeZone: string): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return utcCalendarDate(instantFromEpoch(value));
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isIsoDate(trimmed)) return trimmed;
  const monthDayYear = MDY_DATE.exec(trimmed);
  if (monthDayYear) return monthDayYearDate(monthDayYear[1] ?? "", monthDayYear[2] ?? "", monthDayYear[3] ?? "");
  const midnight = ISO_MIDNIGHT_Z.exec(trimmed);
  if (midnight?.[1]) return midnight[1];
  if (/^\d+$/.test(trimmed)) return utcCalendarDate(instantFromEpoch(Number(trimmed)));
  const instant = parseInstant(trimmed);
  if (!instant) return null;
  return utcCalendarDate(instant);
}

export function businessDateString(date: Date, timeZone: string): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

export function calendarDayDifference(later: string, earlier: string): number | null {
  const end = isoDateToUtc(later);
  const start = isoDateToUtc(earlier);
  if (!end || !start) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

export function addCalendarDays(isoDate: string, days: number): string | null {
  const date = isoDateToUtc(isoDate);
  if (!date || !Number.isFinite(days)) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function utcCalendarDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function monthDayYearDate(month: string, day: string, year: string): string | null {
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const yearNumber = Number(year);
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    date.getUTCFullYear() !== yearNumber ||
    date.getUTCMonth() !== monthNumber - 1 ||
    date.getUTCDate() !== dayNumber
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function instantFromEpoch(value: number): Date | null {
  if (!Number.isFinite(value) || value < 1e9) return null;
  const ms = value >= 1e12 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDateToUtc(isoDate: string): Date | null {
  if (!isIsoDate(isoDate)) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
