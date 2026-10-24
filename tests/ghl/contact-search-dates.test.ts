import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseContactPage } from "../../src/ghl/parse";
import { parseStoredDate } from "../../src/time/business-date";

const LAST_ORDER_DATE_ID = "WUgA196HILTt2ul6vfqf";

describe("contact search DATE fields", () => {
  it("keeps all four stored date shapes on the UTC calendar day in a negative-offset zone", () => {
    const body = JSON.parse(readFileSync("fixtures/contact-search-dates.json", "utf8")) as unknown;
    const page = parseContactPage(body);
    expect(page.contacts.map((contact) => contact.id)).toEqual([
      "contact_date_ymd",
      "contact_date_search_iso",
      "contact_date_mdy",
      "contact_date_epoch",
    ]);
    expect(page.searchAfter).toEqual(["2026-10-21T18:47:57.185Z", "contact_date_epoch"]);
    const dates = page.contacts.map((contact) => {
      const raw = contact.customFields.find((field) => field.id === LAST_ORDER_DATE_ID)?.value;
      return parseStoredDate(raw, "America/New_York");
    });
    expect(dates).toEqual(["2026-10-21", "2026-10-21", "2026-10-21", "2026-10-21"]);
  });
});
