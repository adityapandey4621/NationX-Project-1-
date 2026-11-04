import { describe, expect, it } from "vitest";
import { formatDateLong, formatTime12h, getClosureNotice, getOpenStatus, istDate } from "./opening-hours";

// IST = UTC+5:30. 2026-11-02 is a Monday.
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);

describe("istDate", () => {
  it("is the calendar date in India, not in UTC", () => {
    expect(istDate(ist("2026-11-02T00:10:00"))).toBe("2026-11-02"); // still 2 Nov in IST, 1 Nov 18:40 UTC
    expect(istDate(ist("2026-11-02T23:59:00"))).toBe("2026-11-02");
    expect(istDate(new Date("2026-11-02T19:00:00Z"))).toBe("2026-11-03"); // 00:30 on 3 Nov in IST
  });
});

describe("getClosureNotice", () => {
  const today = ist("2026-11-02T12:00:00");
  it("is null when the shop has not said it is closed", () => {
    expect(getClosureNotice({ closure_note: null, closed_until: null }, today)).toBeNull();
    expect(getClosureNotice({ closure_note: "   ", closed_until: null }, today)).toBeNull();
  });
  it("stays in force without a date until the shop clears it", () => {
    expect(getClosureNotice({ closure_note: " Family function ", closed_until: null }, today)).toEqual({ note: "Family function", until: null });
  });
  it("is in force through the closing date (inclusive) and lapses the day after", () => {
    const sf = { closure_note: "Renovation", closed_until: "2026-11-02" };
    expect(getClosureNotice(sf, ist("2026-11-02T23:30:00"))).toEqual({ note: "Renovation", until: "2026-11-02" });
    expect(getClosureNotice(sf, ist("2026-11-03T00:05:00"))).toBeNull();
  });
  it("uses India's date: 00:30 IST on the next day is already expired even though UTC is still the old day", () => {
    expect(getClosureNotice({ closure_note: "x", closed_until: "2026-11-02" }, new Date("2026-11-02T19:00:00Z"))).toBeNull();
  });
  it("a future date keeps it in force", () => {
    expect(getClosureNotice({ closure_note: "x", closed_until: "2026-12-01" }, today)).not.toBeNull();
  });
});

describe("formatDateLong", () => {
  it("formats a calendar date without time-zone drift", () => {
    expect(formatDateLong("2030-01-15")).toBe("15 Jan 2030");
    expect(formatDateLong("2026-12-31")).toBe("31 Dec 2026");
  });
  it("returns the input when it is not a date", () => {
    expect(formatDateLong("soon")).toBe("soon");
  });
});

const hours = { opens: "09:00", closes: "21:00", closed_days: ["tuesday"] };

describe("getOpenStatus (evaluated in IST)", () => {
  it("is open during hours and closed outside them", () => {
    expect(getOpenStatus(hours, ist("2026-11-02T12:00:00"))).toBe("open");
    expect(getOpenStatus(hours, ist("2026-11-02T08:59:00"))).toBe("closed");
    expect(getOpenStatus(hours, ist("2026-11-02T21:00:00"))).toBe("closed");
  });
  it("respects weekly closed days", () => {
    expect(getOpenStatus(hours, ist("2026-11-03T12:00:00"))).toBe("closed"); // Tuesday
    expect(getOpenStatus({ ...hours, closed_days: ["Tuesday"] }, ist("2026-11-03T12:00:00"))).toBe("closed");
  });
  it("uses India time regardless of server timezone", () => {
    // 20:00 UTC on Monday is 01:30 Tuesday in IST → closed (before opening, and Tuesday is off).
    expect(getOpenStatus(hours, new Date("2026-11-02T20:00:00Z"))).toBe("closed");
    // 04:00 UTC Monday is 09:30 IST Monday → open.
    expect(getOpenStatus(hours, new Date("2026-11-02T04:00:00Z"))).toBe("open");
  });
  it("handles hours past midnight", () => {
    const night = { opens: "18:00", closes: "02:00", closed_days: [] };
    expect(getOpenStatus(night, ist("2026-11-02T23:00:00"))).toBe("open");
    expect(getOpenStatus(night, ist("2026-11-02T01:00:00"))).toBe("open");
    expect(getOpenStatus(night, ist("2026-11-02T12:00:00"))).toBe("closed");
  });
});

describe("formatTime12h", () => {
  it("formats 24h times", () => {
    expect(formatTime12h("08:30")).toBe("8:30 AM");
    expect(formatTime12h("00:05")).toBe("12:05 AM");
    expect(formatTime12h("12:00")).toBe("12:00 PM");
    expect(formatTime12h("21:45")).toBe("9:45 PM");
  });
});
