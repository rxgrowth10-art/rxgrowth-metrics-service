import { describe, expect, it } from "vitest";
import { addCalendarDays, businessDateString, calendarDayDifference } from "../../src/time/business-date";

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
});
