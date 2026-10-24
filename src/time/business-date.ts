const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MDY_DATE = /^(\d{2})-(\d{2})-(\d{4})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

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
 * Accepted shapes are `YYYY-MM-DD`, legacy `MM-DD-YYYY`, an ISO datetime (its UTC
 * year-month-day, including `2026-10-21T00:00:00.000Z`), and epoch milliseconds.
 * Other text, including `10/21/2026`, is rejected. Impossible dates such as
 * `2026-02-31` are rejected.
 */
export function parseStoredDate(value: unknown, _timeZone: string): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return utcCalendarDate(epochMilliseconds(value));
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isIsoDate(trimmed)) return realIsoDate(trimmed);
  const monthDayYear = MDY_DATE.exec(trimmed);
  if (monthDayYear) return monthDayYearDate(monthDayYear[1] ?? "", monthDayYear[2] ?? "", monthDayYear[3] ?? "");
  if (/^\d+$/.test(trimmed)) return utcCalendarDate(epochMilliseconds(Number(trimmed)));
  return isoDateTimeUtcDay(trimmed);
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
  if (!isRealCalendarDate(yearNumber, monthNumber, dayNumber)) return null;
  return `${year}-${month}-${day}`;
}

function realIsoDate(isoDate: string): string | null {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  if (!isRealCalendarDate(year, month, day)) return null;
  return isoDate;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Epoch milliseconds only. A seconds-scale number is not a stored DATE. */
function epochMilliseconds(value: number): Date | null {
  if (!Number.isFinite(value) || value < 1e12) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDateTimeUtcDay(value: string): string | null {
  const match = ISO_DATETIME.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!isRealCalendarDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return utcCalendarDate(instant);
}

function instantFromEpoch(value: number): Date | null {
  if (!Number.isFinite(value) || value < 1e9) return null;
  const ms = value >= 1e12 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDateToUtc(isoDate: string): Date | null {
  if (!realIsoDate(isoDate)) return null;
  return new Date(`${isoDate}T00:00:00Z`);
}
