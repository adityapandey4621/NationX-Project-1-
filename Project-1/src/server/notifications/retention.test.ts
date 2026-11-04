import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_RETENTION_DAYS, eventRetentionDays } from "./retention";

describe("eventRetentionDays", () => {
  it("uses the default when unset or blank", () => {
    expect(eventRetentionDays(undefined)).toBe(DEFAULT_EVENT_RETENTION_DAYS);
    expect(eventRetentionDays("")).toBe(DEFAULT_EVENT_RETENTION_DAYS);
    expect(eventRetentionDays("   ")).toBe(DEFAULT_EVENT_RETENTION_DAYS);
  });
  it("accepts a whole number of at least 7 days", () => {
    expect(eventRetentionDays("7")).toBe(7);
    expect(eventRetentionDays(" 90 ")).toBe(90);
  });
  it("falls back to the default for values that are too small, negative, fractional or not numbers", () => {
    for (const bad of ["0", "1", "6", "-30", "7.5", "thirty", "30d", "1e3", "99999"]) {
      expect(eventRetentionDays(bad), bad).toBe(DEFAULT_EVENT_RETENTION_DAYS);
    }
  });
});
