import { describe, expect, it } from "vitest";
import { formatDistance, parseCoords, serializeCoords } from "./geo";

describe("parseCoords", () => {
  it("accepts a valid pair", () => expect(parseCoords("17.247,80.151")).toEqual({ lat: 17.247, lng: 80.151 }));
  it("accepts negatives", () => expect(parseCoords("-33.9,151.2")).toEqual({ lat: -33.9, lng: 151.2 }));
  it.each([undefined, null, "", "abc", "17.2", "17.2,80.1,5", "91,10", "10,181", "1e3,5", "17.2;DROP,80"])("rejects %s", (v) =>
    expect(parseCoords(v)).toBeNull(),
  );
});

describe("serializeCoords", () => {
  it("rounds to about 110 m", () => expect(serializeCoords({ lat: 17.24731, lng: 80.15149 })).toBe("17.247,80.151"));
  it("round-trips through parseCoords", () => expect(parseCoords(serializeCoords({ lat: 17.2473, lng: 80.1514 }))).toEqual({ lat: 17.247, lng: 80.151 }));
});

describe("formatDistance", () => {
  it("shows metres under 1 km, never 0 m", () => {
    expect(formatDistance(0.35)).toBe("400 m");
    expect(formatDistance(0.01)).toBe("100 m");
  });
  it("shows one decimal under 10 km", () => expect(formatDistance(1.24)).toBe("1.2 km"));
  it("rounds beyond 10 km", () => expect(formatDistance(12.6)).toBe("13 km"));
  it("is null when unknown", () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance(Number.NaN)).toBeNull();
    expect(formatDistance(-1)).toBeNull();
  });
});