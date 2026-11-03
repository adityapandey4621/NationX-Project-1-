import { describe, expect, it } from "vitest";
import { formatTime12h, getOpenStatus } from "./opening-hours";

// IST = UTC+5:30. 2026-11-02 is a Monday.
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);

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
