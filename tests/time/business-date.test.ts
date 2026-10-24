import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  businessDateString,
  calendarDayDifference,
  parseInstant,
  parseStoredDate,
} from "../../src/time/business-date.js";

describe("business dates", () => {
  it("uses the tenant timezone calendar, not the UTC date", () => {
    const instant = new Date("2026-01-01T22:30:00.000Z");
    expect(businessDateString(instant, "Africa/Cairo")).toBe("2026-01-02");
    expect(businessDateString(instant, "America/New_York")).toBe("2026-01-01");
    expect(businessDateString(instant, "UTC")).toBe("2026-01-01");
  });

  it("counts calendar days and shifts iso dates without a zero-day gap", () => {
    expect(calendarDayDifference("2026-01-11", "2026-01-01")).toBe(10);
    expect(calendarDayDifference("2026-01-01", "2026-01-01")).toBe(0);
    expect(addCalendarDays("2026-01-01", 10)).toBe("2026-01-11");
    expect(calendarDayDifference("not-a-date", "2026-01-01")).toBeNull();
  });

  it("parses calendar dates, ISO timestamps, and epoch milliseconds", () => {
    const epochMs = Date.parse("2026-01-01T00:00:00.000Z");
    expect(parseStoredDate("2026-01-01", "America/New_York")).toBe("2026-01-01");
    expect(parseStoredDate("2026-01-01T22:30:00.000Z", "Africa/Cairo")).toBe("2026-01-01");
    expect(parseInstant(epochMs)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseInstant(String(epochMs))?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseInstant(String(Math.floor(epochMs / 1000)))?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseStoredDate(String(epochMs), "UTC")).toBe("2026-01-01");
    expect(parseStoredDate(String(epochMs), "America/New_York")).toBe("2026-01-01");
    expect(parseStoredDate(epochMs, "America/New_York")).toBe("2026-01-01");
  });

  it("reads a stored DATE field as a UTC calendar date in a negative-offset zone", () => {
    const epochMs = Date.parse("2026-10-21T00:00:00.000Z");
    expect(parseStoredDate("2026-10-21", "America/New_York")).toBe("2026-10-21");
    expect(parseStoredDate("10-21-2026", "America/New_York")).toBe("2026-10-21");
    expect(parseStoredDate("2026-10-21T00:00:00.000Z", "America/New_York")).toBe("2026-10-21");
    expect(parseStoredDate("2026-10-21T00:00:00.000Z", "America/Chicago")).toBe("2026-10-21");
    expect(parseStoredDate("2026-10-21T00:00:00Z", "America/New_York")).toBe("2026-10-21");
    expect(parseStoredDate(epochMs, "America/New_York")).toBe("2026-10-21");
    expect(parseStoredDate(String(epochMs), "America/New_York")).toBe("2026-10-21");
    expect(parseStoredDate("02-31-2026", "America/New_York")).toBeNull();
    expect(businessDateString(new Date("2026-10-21T00:00:00.000Z"), "America/New_York")).toBe("2026-10-20");
  });

  it("rejects unlisted date shapes and impossible calendar days", () => {
    expect(parseStoredDate("10/21/2026", "America/Chicago")).toBeNull();
    expect(parseStoredDate("2026/10/21", "America/Chicago")).toBeNull();
    expect(parseStoredDate("October 21, 2026", "UTC")).toBeNull();
    expect(parseStoredDate("2026-02-31", "UTC")).toBeNull();
    expect(parseStoredDate("2026-02-31T00:00:00.000Z", "UTC")).toBeNull();
    expect(parseStoredDate("2026-04-31", "UTC")).toBeNull();
    expect(parseStoredDate("2026-02-29", "UTC")).toBeNull();
    expect(parseStoredDate("2024-02-29", "UTC")).toBe("2024-02-29");
    expect(parseStoredDate("2026-10-21T23:30:00-05:00", "America/Chicago")).toBe("2026-10-22");
    const epochMs = Date.parse("2026-10-21T00:00:00.000Z");
    expect(parseStoredDate(Math.floor(epochMs / 1000), "UTC")).toBeNull();
    expect(parseStoredDate(String(Math.floor(epochMs / 1000)), "UTC")).toBeNull();
  });
});
