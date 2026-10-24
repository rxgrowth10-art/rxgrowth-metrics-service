const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
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

function isoDateToUtc(isoDate: string): Date | null {
  if (!isIsoDate(isoDate)) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
