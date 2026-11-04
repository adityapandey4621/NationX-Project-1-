import { isOpenNow, istParts } from "../src/lib/hours";

const hours = { opens: "09:00", closes: "21:00", closed_days: ["tuesday"] };
// 2026-11-02 is a Monday (IST). IST = UTC+5:30.
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("India Standard Time", () => {
  it("converts the instant to IST weekday and minutes", () => {
    expect(istParts(new Date("2026-11-02T20:00:00Z"))).toEqual({ weekday: "tuesday", minutes: 1 * 60 + 30 }); // 01:30 next day in IST
    expect(istParts(ist("2026-11-02T09:30:00"))).toEqual({ weekday: "monday", minutes: 9 * 60 + 30 });
  });
});

describe("isOpenNow", () => {
  it("is open inside hours and closed outside", () => {
    expect(isOpenNow(hours, ist("2026-11-02T12:00:00"))).toBe(true);
    expect(isOpenNow(hours, ist("2026-11-02T08:59:00"))).toBe(false);
    expect(isOpenNow(hours, ist("2026-11-02T21:00:00"))).toBe(false);
  });
  it("is closed on the weekly off day", () => {
    expect(isOpenNow(hours, ist("2026-11-03T12:00:00"))).toBe(false);
  });
  it("handles hours that run past midnight", () => {
    const late = { opens: "18:00", closes: "02:00", closed_days: [] };
    expect(isOpenNow(late, ist("2026-11-02T23:00:00"))).toBe(true);
    expect(isOpenNow(late, ist("2026-11-03T01:00:00"))).toBe(true);
    expect(isOpenNow(late, ist("2026-11-03T03:00:00"))).toBe(false);
  });
  it("treats equal open and close times as open all day", () => {
    expect(isOpenNow({ opens: "00:00", closes: "00:00", closed_days: [] }, ist("2026-11-02T04:00:00"))).toBe(true);
  });
});